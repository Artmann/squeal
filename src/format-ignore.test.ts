import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { join, resolve } from 'path'
import invariant from 'tiny-invariant'
import { describe, expect, it } from 'vitest'

// `doctor.config.json` says what in this repository is not source. The
// formatter has its own list and they disagreed: `design/squeal-sql-editor.html`
// is a 252 KB bundle whose script block the design tool generates, declared
// not-source there and walked by a whole-repository format anyway.
//
// This is not a hypothetical cost. `459efbf style: format the repo with
// prettier` reformatted that one file by 917 lines — 81% of everything that
// commit changed — and the bundle is only formatter-shaped today because the
// formatter reshaped it then. The bill arrives again the next time the design
// tool regenerates it.
//
// `ignore.files` is the right list to compare against rather than the whole
// config: `overrides` already exists for source the linter skips for other
// reasons, and holds `src/preload.ts` — real source, reached through
// `forge.config.ts` instead of an import. So an entry under `ignore.files` is a
// claim that the formatter has no business there either.
//
// The stronger test would ask oxfmt's own matcher instead of comparing the two
// declarations textually. That means shelling out to the binary once per path
// resolved, which the textual comparison buys its way out of. Worth
// reconsidering if the patterns ever grow past prefixes.
//
// The file lives here rather than beside a subject because it has no subject,
// and `src/` is the only directory that both runs under vitest and typechecks
// — see #161.
describe('.oxfmtrc.json ignorePatterns', () => {
  const root = resolve(import.meta.dirname, '..')

  // Both configs are JSONC — their entries carry the comments explaining why
  // each is there, which is most of their value. Only whole-line comments are
  // stripped, because `$schema`'s value contains `//`; a trailing comment or a
  // trailing comma is legal JSONC that this does not handle, and arrives as a
  // bare `SyntaxError` from `JSON.parse`.
  function readJsonc<T>(name: string): T {
    return JSON.parse(
      readFileSync(join(root, name), 'utf-8').replace(/^\s*\/\/.*$/gm, '')
    ) as T
  }

  const formatter = readJsonc<{ ignorePatterns?: string[] }>('.oxfmtrc.json')

  const lines = formatter.ignorePatterns ?? []

  const negations = lines.filter((line) => line.startsWith('!'))
  const patterns = lines.filter((line) => !line.startsWith('!'))

  const configuration = readJsonc<{ ignore?: { files?: string[] } }>(
    'doctor.config.json'
  )

  const declared = configuration.ignore?.files ?? []

  invariant(
    declared.length > 0 && declared.every((entry) => typeof entry === 'string'),
    'doctor.config.json must declare a list of ignored file patterns for this to compare.'
  )

  invariant(
    patterns.length > 0,
    '.oxfmtrc.json must declare `ignorePatterns` for this to compare.'
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
  // report a bundle the formatter formats as covered. Nothing here uses
  // negation, so rather than model gitignore's re-inclusion rules this fails
  // until someone needs them.
  it('has no negated pattern for the comparison below to misread', () => {
    expect(negations).toEqual([])
  })

  it('ignores every path the repository declares is not source', () => {
    const uncovered = declared.filter(
      (entry) =>
        !patterns.some((pattern) => covers(rootOf(pattern), rootOf(entry)))
    )

    expect(
      uncovered,
      'these each need an entry in .oxfmtrc.json `ignorePatterns`'
    ).toEqual([])
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
