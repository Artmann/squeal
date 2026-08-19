import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { join, resolve } from 'path'
import invariant from 'tiny-invariant'
import { describe, expect, it } from 'vitest'

// `doctor.config.json` says what in this repository is not source. Prettier has
// its own list and they disagreed: `design/squeal-sql-editor.html` is a 252 KB
// bundle whose script block the design tool generates, declared not-source
// there and walked by `prettier --write .` anyway.
//
// This is not a hypothetical cost. `459efbf style: format the repo with
// prettier` reformatted that one file by 917 lines — 81% of everything that
// commit changed — and the bundle is only Prettier-shaped today because
// Prettier reshaped it then. The bill arrives again the next time the design
// tool regenerates it.
//
// `ignore.files` is the right list to compare against rather than the whole
// config: `overrides` already exists for source the linter skips for other
// reasons, and holds `src/preload.ts` — real source, reached through
// `forge.config.ts` instead of an import. So an entry under `ignore.files` is a
// claim that the formatter has no business there either.
//
// The stronger test would ask Prettier's own matcher instead of comparing the
// two declarations textually. Importing `prettier` is not available: it is not
// a declared dependency — `package.json` names it in the `format` script and
// nowhere else — and Fallow fails the build on an unlisted one, static import
// or dynamic. Shelling out to `prettier --file-info` does dodge that, at the
// price of a 1.2 s subprocess per path resolved through a binary this
// repository never asked for. Not worth it before #107 lands; worth
// reconsidering after.
//
// The file lives here rather than beside a subject because it has no subject,
// and `src/` is the only directory that both runs under vitest and typechecks
// — see #161.
describe('.prettierignore', () => {
  const root = resolve(import.meta.dirname, '..')

  const lines = readFileSync(join(root, '.prettierignore'), 'utf-8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))

  const negations = lines.filter((line) => line.startsWith('!'))
  const patterns = lines.filter((line) => !line.startsWith('!'))

  // The config is JSONC — its entries carry the comments explaining why each is
  // there, which is most of their value. Only whole-line comments are stripped,
  // because `$schema`'s value contains `//`; a trailing comment or a trailing
  // comma is legal JSONC that this does not handle, and arrives as a bare
  // `SyntaxError` from `JSON.parse`.
  const configuration = JSON.parse(
    readFileSync(join(root, 'doctor.config.json'), 'utf-8').replace(
      /^\s*\/\/.*$/gm,
      ''
    )
  ) as { ignore?: { files?: string[] } }

  const declared = configuration.ignore?.files ?? []

  invariant(
    declared.length > 0 && declared.every((entry) => typeof entry === 'string'),
    'doctor.config.json must declare a list of ignored file patterns for this to compare.'
  )

  /**
   * The directory a pattern is rooted at, so the two files can be compared
   * whichever of gitignore's equivalent spellings each happens to use:
   * `design/**`, `/design/`, and `design/` are one claim about `design`.
   */
  function rootOf(pattern: string): string {
    return pattern
      .replace(/\/\*+$/, '')
      .replace(/^\//, '')
      .replace(/\/$/, '')
  }

  function covers(pattern: string, target: string): boolean {
    return target === pattern || target.startsWith(`${pattern}/`)
  }

  /**
   * The files git tracks under a path. Both files are claims about the
   * repository, so the repository's own list is what they should be checked
   * against: a design-tool temp file or an editor swap file appearing in
   * `design/` is not a change to anything declared, and `readdirSync` cannot
   * tell the difference.
   */
  function trackedFiles(target: string): string[] {
    return execFileSync('git', ['ls-files', '-z', '--', target], {
      cwd: root,
      encoding: 'utf-8',
      timeout: 30_000
    })
      .split('\0')
      .filter((path) => path.length > 0)
  }

  // A `!` line re-includes what an earlier line excluded, and the prefix
  // comparison above reads it as one more exclusion — so the test below would
  // report a bundle Prettier formats as covered. Measured: `design/` followed
  // by `!design/` makes `prettier --file-info` answer `"ignored": false` while
  // both assertions pass. Nothing here uses negation, so rather than model
  // gitignore's re-inclusion rules this fails until someone needs them.
  it('has no negated pattern for the comparison below to misread', () => {
    expect(negations).toEqual([])
  })

  it('ignores every path the repository declares is not source', () => {
    const uncovered = declared.filter(
      (entry) =>
        !patterns.some((pattern) => covers(rootOf(pattern), rootOf(entry)))
    )

    expect(uncovered, 'these each need a line in .prettierignore').toEqual([])
  })

  // An ignore entry for a path that holds nothing is decoration — `build/` and
  // `dist/` in this same file name directories that do not exist. Asking git
  // what is under each declared path says the entry is live without failing
  // over a rename: `design/` covers whatever is in there, so the design tool
  // emitting a new filename is not a defect.
  it('ignores paths that are really in the repository', () => {
    const empty = declared.filter(
      (entry) => trackedFiles(rootOf(entry)).length === 0
    )

    expect(empty, 'these ignore entries name nothing git tracks').toEqual([])
  })
})
