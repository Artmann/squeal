import type { ForgeConfig } from '@electron-forge/shared-types'
import { MakerSquirrel } from '@electron-forge/maker-squirrel'
import { MakerDMG } from '@electron-forge/maker-dmg'
import { MakerDeb } from '@electron-forge/maker-deb'
import { MakerRpm } from '@electron-forge/maker-rpm'
import { MakerZIP } from '@electron-forge/maker-zip'
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives'
import { VitePlugin } from '@electron-forge/plugin-vite'
import { FusesPlugin } from '@electron-forge/plugin-fuses'
import { FuseV1Options, FuseVersion } from '@electron/fuses'
import { execFileSync } from 'child_process'
import { cpSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { join, resolve } from 'path'

// A relative path rather than the `@` alias: Forge loads this config through
// its own TypeScript loader, which knows nothing of the Vite alias.
import {
  asarUnpackGlob,
  rootExternalPackages
} from './src/build/native-packages'

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

// Signing only happens when CI has handed over the Apple secrets, so `yarn make`
// still works on a machine that has none.
const signsWithAppleIdentity = Boolean(process.env.APPLE_TEAM_ID)

function adHocSign(appPath: string): void {
  try {
    // The same arguments @electron/fuses uses for its own reset.
    execFileSync('codesign', [
      '--sign',
      '-',
      '--force',
      '--preserve-metadata=entitlements,requirements,flags,runtime',
      '--deep',
      appPath
    ])
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)

    throw new Error(
      `Could not ad-hoc sign ${appPath}, so the build would not launch: ${reason}. Check that the Xcode command line tools are installed (\`xcode-select --install\`) and that \`codesign\` runs by hand.`
    )
  }
}

// Gives an unsigned macOS build the ad-hoc signature the fuses plugin would
// normally apply, except on the merged universal app rather than on one of its
// two slices — see the FusesPlugin comment below for why that has to wait until
// here. Without it, an arm64 machine kills the app on launch: flipping fuses
// voided the signature Electron shipped with, and macOS runs no arm64 code that
// carries a broken one.
//
// Does nothing once osxSign is configured. This runs after packager has signed
// and notarized, so re-signing here would throw the real signature away.
function adHocSignIfUnsigned(outputPaths: string[]): void {
  if (signsWithAppleIdentity) {
    return
  }

  for (const outputPath of outputPaths) {
    const appPath = join(outputPath, 'Squeal.app')

    if (existsSync(appPath)) {
      adHocSign(appPath)
    }
  }
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
    // `Squeal-<version>-<arch>.dmg`, which for the universal build macOS ships
    // is `Squeal-<version>-universal.dmg`. Naming it says out loud that one
    // download covers both architectures.
    new MakerDMG({ icon: './assets/icons/icon.icns' }, ['darwin']),
    // The DMG is for the first install; this zip is what Squirrel.Mac
    // installs. Do not remove it — Squirrel.Mac cannot read a DMG, so dropping
    // this maker silently ends macOS auto-updates while every build still
    // passes. The name it derives from the packaged directory
    // (`Squeal-darwin-universal-<version>.zip`) is also what
    // update.electronjs.org matches on: the `-universal` in it is what makes
    // the feed serve this one asset to `darwin-x64` and `darwin-arm64` clients
    // alike, which is how an install running under Rosetta gets migrated to a
    // native binary.
    new MakerZIP({}, ['darwin']),
    // `bin` is the executable inside the packaged app, so it has to match
    // packager's executable name — `Squeal`, see packagerConfig below. The
    // installed command is still the conventional lowercase `/usr/bin/squeal`:
    // that name comes from the package name, not from `bin`. Getting this wrong
    // fails the build with "could not find the Electron app binary".
    new MakerRpm({
      options: { bin: 'Squeal', icon: './assets/icons/icon.png' }
    }),
    new MakerDeb({
      options: { bin: 'Squeal', icon: './assets/icons/icon.png' }
    })
  ],
  packagerConfig: {
    appBundleId: 'co.artmann.squeal',
    asar: {
      unpack: asarUnpackGlob
    },
    // macOS ships one universal build, stitched from an x64 slice and an arm64
    // slice that are both packaged from this machine's node_modules — so both
    // of them carry both of libsql's macOS bindings (see
    // `scripts/fetch-macos-bindings.ts`, which `yarn make:mac` runs first).
    // That leaves @electron/universal looking at two single-arch Mach-O files
    // that are identical across the slices, which it refuses to merge unless
    // they are named here. Keeping one copy of each is right: libsql resolves
    // its binding with `require(`@libsql/${currentTarget()}`)`, so the merged
    // app picks the one for whichever architecture it runs as.
    osxUniversal: {
      x64ArchFiles: '**/@libsql/*/index.node'
    },
    // No `executableName` on purpose, so it defaults to the product name and
    // the executable is `Squeal`. Packager writes CFBundleDisplayName from the
    // executable name rather than from the product name, so `executableName:
    // 'squeal'` is what made Finder label the bundle "squeal" even though the
    // bundle directory was `Squeal.app`. The Linux packages get their lowercase
    // command from the package name; see the `bin` options above.
    icon: './assets/icons/icon',
    // Only sign when the CI secrets are present, so `yarn make` still works
    // locally. Unsigned builds launch from disk but are not distributable: all
    // they get is the ad-hoc signature from `adHocSignIfUnsigned`, which no
    // Developer ID backs and nothing notarizes, so macOS rejects the app once
    // it carries a download's quarantine flag.
    ...(signsWithAppleIdentity && {
      osxNotarize: {
        appleId: process.env.APPLE_ID ?? '',
        appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD ?? '',
        // Never empty in practice — it is what `signsWithAppleIdentity`
        // tests for — but the check is a `Boolean(...)` TypeScript cannot
        // narrow through, and notarization requires a string.
        teamId: process.env.APPLE_TEAM_ID ?? ''
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
    // not verify is what macOS reports as "damaged". Signed builds get a valid
    // signature from osxSign, which runs after the fuses are flipped.
    //
    // resetAdHocDarwinSignature is off because macOS builds are universal. Left
    // to itself the plugin turns it on for the arm64 slice only, and only when
    // there is no osxSign — which re-signs that slice and leaves it carrying
    // `_CodeSignature/CodeResources` files the x64 slice does not have.
    // @electron/universal then refuses to merge them: "the number of mach-o
    // files is not the same between the arm64 and x64 builds". The two slices
    // have to stay symmetric, so an unsigned build gets its ad-hoc signature
    // from the postPackage hook below, applied to the merged app instead.
    new FusesPlugin({
      resetAdHocDarwinSignature: false,
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
    },
    postPackage: async (_forgeConfig, packageResult) => {
      if (packageResult.platform === 'darwin') {
        adHocSignIfUnsigned(packageResult.outputPaths)
      }
    }
  },
  rebuildConfig: {}
}

export default config
