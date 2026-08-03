import type { ForgeConfig } from '@electron-forge/shared-types'
import { MakerSquirrel } from '@electron-forge/maker-squirrel'
import { MakerDMG } from '@electron-forge/maker-dmg'
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
const rootExternalPackages = ['@libsql/client', 'mysql2', 'pg', 'pg-cursor']

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
    new MakerSquirrel({
      // Pinned to the old lowercase id on purpose. Squirrel derives its package
      // id from the app name, and a changed id installs alongside the existing
      // app instead of upgrading it.
      name: 'squeal'
    }),
    // Deliberately no `name`: without one the maker names its output
    // `Squeal-<version>-<arch>.dmg`, so the arm64 and x64 jobs don't overwrite
    // each other when the release upload runs with --clobber.
    new MakerDMG({ icon: './assets/icons/icon.icns' }, ['darwin']),
    new MakerRpm({
      options: { bin: 'squeal', icon: './assets/icons/icon.png' }
    }),
    new MakerDeb({
      options: { bin: 'squeal', icon: './assets/icons/icon.png' }
    })
  ],
  packagerConfig: {
    appBundleId: 'co.artmann.squeal',
    asar: {
      // Kept in step with rootExternalPackages: these resolve at runtime, so
      // they must stay outside the archive. libsql carries the native binding.
      unpack: '**/node_modules/{@libsql,libsql,mysql2,pg,pg-cursor}/**/*'
    },
    // The bundle is "Squeal", but the binary inside it stays lowercase so the
    // Linux package binaries keep a conventional name.
    executableName: 'squeal',
    icon: './assets/icons/icon',
    // Only sign when the CI secrets are present, so `yarn make` still works
    // locally. Unsigned builds launch from disk but are not distributable: the
    // fuses plugin re-applies an ad-hoc signature before packager rewrites
    // Info.plist, so the signature does not verify and macOS rejects the app
    // once it carries a download's quarantine flag.
    ...(process.env.APPLE_TEAM_ID && {
      osxNotarize: {
        appleId: process.env.APPLE_ID ?? '',
        appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD ?? '',
        teamId: process.env.APPLE_TEAM_ID
      },
      osxSign: {
        identity: 'Developer ID Application',
        optionsForFile: (filePath: string) => {
          // Entitlements belong on the main bundle only. Helper apps and the
          // individual native binaries just need the hardened runtime.
          const isMainAppBundle =
            filePath.endsWith('.app') && !filePath.includes('Helper')

          return {
            hardenedRuntime: true,
            ...(isMainAppBundle && {
              entitlements: resolve(import.meta.dirname, 'entitlements.plist')
            })
          }
        }
      }
    })
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
    // Fuses enable/disable Electron functionality at package time, before the
    // app is code signed.
    //
    // Flipping them rewrites bytes in the Electron binary, which voids the
    // ad-hoc signature it ships with — a quarantined app whose signature does
    // not verify is what macOS reports as "damaged". Don't set
    // resetAdHocDarwinSignature here: the plugin already enables it when
    // packagerConfig has no osxSign, and setting it explicitly would override
    // that logic. Signed builds get a valid signature from osxSign, which runs
    // after the fuses are flipped.
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
