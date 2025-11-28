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
const rootExternalPackages = ['@libsql/client', 'pg']

// Recursively find all dependencies of a package.
function getPackageDependencies(
  nodeModulesPath: string,
  packageName: string,
  visited = new Set<string>()
): string[] {
  if (visited.has(packageName)) {
    return []
  }
  visited.add(packageName)

  const packagePath = join(nodeModulesPath, ...packageName.split('/'))
  const packageJsonPath = join(packagePath, 'package.json')

  if (!existsSync(packageJsonPath)) {
    return []
  }

  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
  const deps = [
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.optionalDependencies ?? {})
  ]

  const allDeps: string[] = []

  for (const dep of deps) {
    allDeps.push(dep)
    allDeps.push(...getPackageDependencies(nodeModulesPath, dep, visited))
  }

  return allDeps
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
      unpack: '**/node_modules/{@libsql,pg}/**/*'
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

      // Collect all packages and their transitive dependencies.
      const allPackages = new Set<string>()

      for (const rootPackage of rootExternalPackages) {
        allPackages.add(rootPackage)

        for (const dep of getPackageDependencies(
          sourceNodeModules,
          rootPackage
        )) {
          allPackages.add(dep)
        }
      }

      // Copy each package to the build directory.
      for (const packageName of allPackages) {
        const sourcePath = join(sourceNodeModules, ...packageName.split('/'))
        const destPath = join(destNodeModules, ...packageName.split('/'))

        if (existsSync(sourcePath)) {
          mkdirSync(join(destPath, '..'), { recursive: true })
          cpSync(sourcePath, destPath, { recursive: true })
        }
      }
    }
  },
  rebuildConfig: {}
}

export default config
