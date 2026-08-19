/**
 * The one place the list of packages the build leaves to Node is written down.
 *
 * Each is here for its own reason — the `@libsql` scope carries the platform
 * binding for the SQLite driver, and the `pg` and `mysql2` families reach for
 * optional modules of their own by name — but the consequence is the same:
 * bundling them produces a main process that cannot find them. Three
 * build-time declarations need to know that, and each needs it in a different
 * shape: the Vite externals, the packages Forge keeps reachable from the app
 * root, and the asar unpack glob.
 *
 * All three are derived here rather than restated, because the failure mode of
 * restating them is a green build that ships `MODULE_NOT_FOUND`:
 * `src/databases/create-adapter.ts` imports all three adapters at module
 * level, so one missing package breaks every connection type, not just its
 * own.
 */
interface NativePackage {
  /**
   * What the package occupies inside `node_modules` — the scope directory for a
   * scoped package, since its platform binding is a sibling in that scope.
   */
  readonly directories: readonly string[]
  /** Module ids Vite must leave for the runtime to resolve. */
  readonly externals: readonly RegExp[]
  /**
   * The packages that have to be reachable from the packaged app's root, which
   * Forge copies there itself. A transitive dependency comes along with the
   * package that requires it, so naming one is not strictly required — but a
   * package this app imports by name is named here anyway, rather than left to
   * survive on someone else's dependency list.
   */
  readonly roots: readonly string[]
}

export const nativePackages: readonly NativePackage[] = [
  {
    // `libsql` is the driver, and its platform binding is an optional
    // dependency in the `@libsql` scope beside the client.
    directories: ['@libsql', 'libsql'],
    externals: [/^@libsql(\/.*)?$/, /^libsql(\/.*)?$/],
    // Both are imported by name: the client by `src/databases/libsql-*`, and
    // `libsql` itself by `src/databases/sqlite-adapter.ts`.
    roots: ['@libsql/client', 'libsql']
  },
  {
    directories: ['mysql2'],
    externals: [/^mysql2(\/.*)?$/],
    roots: ['mysql2']
  },
  {
    directories: ['pg'],
    externals: [/^pg(\/.*)?$/],
    roots: ['pg']
  },
  {
    // Not a dependency of `pg`, so it has to be named on its own.
    directories: ['pg-cursor'],
    externals: [/^pg-cursor(\/.*)?$/],
    roots: ['pg-cursor']
  }
]

/**
 * Optional native accelerators of `ws`, pulled in via
 * `@effect/platform-node`. Not installed — `ws` catches the failed require at
 * runtime — but Vite must not try to resolve them. Nothing resolves them at
 * runtime either, so they are external without being roots or unpacked.
 */
const optionalAccelerators: readonly string[] = [
  'bufferutil',
  'utf-8-validate'
]

export const rollupExternals: (RegExp | string)[] = [
  ...nativePackages.flatMap((nativePackage) => nativePackage.externals),
  ...optionalAccelerators
]

export const rootExternalPackages: readonly string[] = nativePackages.flatMap(
  (nativePackage) => nativePackage.roots
)

const unpackedDirectories = nativePackages.flatMap(
  (nativePackage) => nativePackage.directories
)

export const asarUnpackGlob = `**/node_modules/{${unpackedDirectories.join(',')}}/**/*`
