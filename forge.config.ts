import type { ForgeConfig } from '@electron-forge/shared-types'
import { MakerSquirrel } from '@electron-forge/maker-squirrel'
import { MakerZIP } from '@electron-forge/maker-zip'
import { MakerDeb } from '@electron-forge/maker-deb'
import { MakerRpm } from '@electron-forge/maker-rpm'
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives'
import { VitePlugin } from '@electron-forge/plugin-vite'
import { FusesPlugin } from '@electron-forge/plugin-fuses'
import { FuseV1Options, FuseVersion } from '@electron/fuses'
import { cpSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { join, resolve } from 'path'

// Root external packages (Vite externals that need runtime resolution).
// Every module externalized in vite.main.config.ts has to be reachable from
// this list, either directly or as a transitive dependency. mysql2 and
// pg-cursor are not dependencies of @libsql/client or pg, so they need naming:
// src/databases/create-adapter.ts imports all three adapters at module level,
// which means a single missing package breaks every database type, not just its
// own.
const rootExternalPackages = [
  '@libsql/client',
  'mysql2',
  'pg',
  'pg-cursor'
]

interface PackageDependency {
  name: string
  // Optional dependencies are mostly per-platform native binaries, so the ones
  // for other platforms are legitimately absent from this machine.
  optional: boolean
}

function readPackageDependencyNames(
  packageJsonPath: string
): PackageDependency[] {
  if (!existsSync(packageJsonPath)) {
    return []
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))

  return [
    ...Object.keys(packageJson.dependencies ?? {}).map((name) => ({
      name,
      optional: false
    })),
    ...Object.keys(packageJson.optionalDependencies ?? {}).map((name) => ({
      name,
      optional: true
    }))
  ]
}

// Recursively find all dependencies of a package.
function getPackageDependencies(
  nodeModulesPath: string,
  packageName: string,
  visited = new Set<string>()
): PackageDependency[] {
  if (visited.has(packageName)) {
    return []
  }
  visited.add(packageName)

  const packagePath = join(nodeModulesPath, ...packageName.split('/'))
  const packageJsonPath = join(packagePath, 'package.json')
  const allDeps: PackageDependency[] = []

  for (const dep of readPackageDependencyNames(packageJsonPath)) {
    allDeps.push(dep)
    allDeps.push(
      ...getPackageDependencies(nodeModulesPath, dep.name, visited).map(
        // Anything reached through an optional dependency is itself optional.
        (nested) => ({
          name: nested.name,
          optional: dep.optional || nested.optional
        })
      )
    )
  }

  return allDeps
}

// Collect the externalized packages and their transitive dependencies, mapped
// to whether their absence should be reported.
function collectPackagesToCopy(
  sourceNodeModules: string
): Map<string, boolean> {
  const allPackages = new Map<string, boolean>()

  const record = (name: string, optional: boolean) => {
    allPackages.set(name, (allPackages.get(name) ?? true) && optional)
  }

  for (const rootPackage of rootExternalPackages) {
    record(rootPackage, false)

    for (const dep of getPackageDependencies(sourceNodeModules, rootPackage)) {
      record(dep.name, dep.optional)
    }
  }

  return allPackages
}

function copyPackage(
  sourceNodeModules: string,
  destNodeModules: string,
  packageName: string,
  optional: boolean
): void {
  const sourcePath = join(sourceNodeModules, ...packageName.split('/'))
  const destPath = join(destNodeModules, ...packageName.split('/'))

  if (!existsSync(sourcePath)) {
    // Loud on purpose for required packages: silently skipping one turns into a
    // module-not-found crash in the packaged app, long after this build passed.
    // Optional ones are per-platform binaries and are expected to be absent.
    if (!optional) {
      console.warn(
        `[forge] Cannot bundle "${packageName}": ${sourcePath} does not exist.`
      )
    }

    return
  }

  mkdirSync(join(destPath, '..'), { recursive: true })
  cpSync(sourcePath, destPath, { recursive: true })
}

const config: ForgeConfig = {
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({})
  ],
  packagerConfig: {
    asar: {
      // Kept in step with rootExternalPackages: these resolve at runtime, so
      // they must stay outside the archive. libsql carries the native binding.
      unpack: '**/node_modules/{@libsql,libsql,mysql2,pg,pg-cursor}/**/*'
    },
    icon: './assets/icons/icon'
  },
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main'
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload'
        }
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mjs'
        }
      ]
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true
    })
  ],
  hooks: {
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      const sourceNodeModules = resolve(import.meta.dirname, 'node_modules')
      const destNodeModules = join(buildPath, 'node_modules')

      for (const [packageName, optional] of collectPackagesToCopy(
        sourceNodeModules
      )) {
        copyPackage(sourceNodeModules, destNodeModules, packageName, optional)
      }
    }
  },
  rebuildConfig: {}
}

export default config
