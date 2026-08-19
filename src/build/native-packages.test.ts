import { describe, expect, it } from 'vitest'

import forgeConfig from '../../forge.config'
import viteMainConfig from '../../vite.main.config'
import {
  asarUnpackGlob,
  nativePackages,
  rollupExternals,
  rootExternalPackages
} from './native-packages'

// The scope directory of `@scope/name`, and the package name itself otherwise —
// what a package occupies inside `node_modules`.
function nodeModulesDirectory(packageName: string): string {
  const [scope] = packageName.split('/')

  return scope.startsWith('@') ? scope : packageName
}

describe('native packages', () => {
  // Adding a package to `roots` without unpacking its directory ships an app
  // that resolves the module to a path inside the asar archive, where the
  // native binding cannot be loaded.
  it('unpacks the directory of every package that resolves at runtime', () => {
    const missing = nativePackages.flatMap((nativePackage) =>
      nativePackage.roots
        .map(nodeModulesDirectory)
        .filter((directory) => !nativePackage.directories.includes(directory))
    )

    expect(missing).toEqual([])
  })

  // The mirror: a package Vite is allowed to bundle does not resolve at
  // runtime, so naming it as a root promises something the build does not do.
  it('keeps every package that resolves at runtime out of the bundle', () => {
    const bundled = rootExternalPackages.filter(
      (packageName) =>
        !rollupExternals.some((external) =>
          typeof external === 'string'
            ? external === packageName
            : external.test(packageName)
        )
    )

    expect(bundled).toEqual([])
  })

  // Subpath imports are how these packages are actually used —
  // `mysql2/promise`, `@libsql/client/node` — and an external that only covers
  // the bare name lets the subpath be bundled.
  it('keeps subpath imports of those packages out of the bundle too', () => {
    const bundled = rootExternalPackages.filter(
      (packageName) =>
        !rollupExternals.some(
          (external) =>
            typeof external !== 'string' && external.test(`${packageName}/deep`)
        )
    )

    expect(bundled).toEqual([])
  })

  it('names every unpacked directory once', () => {
    const directories = nativePackages.flatMap(
      (nativePackage) => nativePackage.directories
    )

    expect([...new Set(directories)]).toEqual(directories)
  })

  // The list Forge walks to decide what stays reachable from the app root. Every
  // other assertion here is a cross-check between two derived views, so this one
  // and the glob below are the only places a package can be dropped outright and
  // still leave the module self-consistent.
  it('names every package this app imports by name', () => {
    expect(rootExternalPackages).toEqual([
      '@libsql/client',
      'libsql',
      'mysql2',
      'pg',
      'pg-cursor'
    ])
  })

  // The accelerators are external without being roots or unpacked, so nothing
  // above cross-checks them. Asserting the whole set of bare names also pins
  // that no package is named twice — once as a string and once by pattern.
  it('leaves the optional ws accelerators to the runtime as well', () => {
    const names = rollupExternals.filter(
      (external) => typeof external === 'string'
    )

    expect(names).toEqual(['bufferutil', 'utf-8-validate'])
  })

  // The glob electron-packager is handed. It is the one derived value with no
  // second reader to catch a mistake, so its shape is asserted directly.
  it('unpacks every directory and nothing else', () => {
    expect(asarUnpackGlob).toEqual(
      '**/node_modules/{@libsql,libsql,mysql2,pg,pg-cursor}/**/*'
    )
  })

  // Everything above holds the module to itself, which a config that had
  // stopped reading it would satisfy just as well — and an emptied externals
  // list still builds, still passes CI, and still throws `MODULE_NOT_FOUND` at
  // the first connection. These two are the only assertions that fail when the
  // wire is cut.
  it('is what Vite externalizes from the main bundle', () => {
    expect(viteMainConfig.build?.rollupOptions?.external).toEqual(
      rollupExternals
    )
  })

  it('is what Forge leaves outside the asar archive', () => {
    expect(forgeConfig.packagerConfig?.asar).toEqual({ unpack: asarUnpackGlob })
  })
})
