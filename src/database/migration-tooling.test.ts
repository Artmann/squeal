import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

import {
  migrationArtifactPath,
  migrationPatterns,
  unappliedMigrationTooling
} from './migration-tooling'

const repositoryRoot = join(import.meta.dirname, '..', '..')

describe('unappliedMigrationTooling', () => {
  it('names an artifact nothing applies', () => {
    expect(
      unappliedMigrationTooling({
        appliers: [],
        artifacts: ['drizzle/0000_graceful_whizzer.sql'],
        dependencies: []
      })
    ).toEqual(['drizzle/0000_graceful_whizzer.sql'])
  })

  it('names a package nothing applies the output of', () => {
    expect(
      unappliedMigrationTooling({
        appliers: [],
        artifacts: [],
        dependencies: ['drizzle-kit']
      })
    ).toEqual(['drizzle-kit'])
  })

  // Generated SQL and something that runs it is a migration system, which is a
  // choice this guard has no opinion about. Only one half without the other is
  // the defect.
  it('says nothing when something applies them', () => {
    expect(
      unappliedMigrationTooling({
        appliers: ['src/database/index.ts'],
        artifacts: ['drizzle'],
        dependencies: ['drizzle-kit']
      })
    ).toEqual([])
  })

  it('says nothing when there is no tooling to apply', () => {
    expect(
      unappliedMigrationTooling({
        appliers: [],
        artifacts: [],
        dependencies: []
      })
    ).toEqual([])
  })

  it('names what it found in one order', () => {
    expect(
      unappliedMigrationTooling({
        appliers: [],
        artifacts: ['drizzle.config.ts'],
        dependencies: ['drizzle-kit']
      })
    ).toEqual(['drizzle-kit', 'drizzle.config.ts'])
  })
})

// Checked against the lines they have to tell apart, because the repository
// guard below cannot check them: with nothing left in the tree to find, a
// pattern that recognises too much and one that recognises too little both
// produce the same empty, passing answer.
describe('migrationPatterns', () => {
  it('reads the generated folder as an artifact', () => {
    expect(migrationPatterns.artifact.test('drizzle')).toEqual(true)
  })

  // The config is the half that is easiest to miss, being one file among the
  // hundred at the top of the tree rather than a folder of its own — and it is
  // the half that names where the next folder gets written.
  it('reads the generator config as an artifact', () => {
    expect(migrationPatterns.artifact.test('drizzle.config.ts')).toEqual(true)
  })

  it('reads an ordinary directory as not an artifact', () => {
    expect(migrationPatterns.artifact.test('src')).toEqual(false)
  })

  it('reads the generator package as one', () => {
    expect(migrationPatterns.generator.test('drizzle-kit')).toEqual(true)
  })

  // The runtime half of drizzle is what the app queries through; it generates
  // nothing, and a guard that read it as a generator would report the whole ORM
  // as tooling to delete.
  it('reads the runtime package as not a generator', () => {
    expect(migrationPatterns.generator.test('drizzle-orm')).toEqual(false)
  })

  it('reads an import of the migrator as one', () => {
    expect(
      migrationPatterns.migrator.test(
        "import { migrate } from 'drizzle-orm/libsql/migrator'"
      )
    ).toEqual(true)
  })

  it('reads a require of the migrator as one', () => {
    expect(
      migrationPatterns.migrator.test(
        "const { migrate } = require('drizzle-orm/libsql/migrator')"
      )
    ).toEqual(true)
  })

  // An applier excuses every artifact in the tree, so a file that merely says
  // the words must not count as one. The comment below is the shape that
  // matters most: it is what this repository's own modules are likeliest to
  // contain, and it once made this very guard inert.
  it('reads prose naming the migrator as not an import of it', () => {
    expect(
      migrationPatterns.migrator.test(
        '// Nothing here runs drizzle-orm/libsql/migrator; tables are created at boot.'
      )
    ).toEqual(false)
  })

  it('reads an ordinary drizzle import as not one', () => {
    expect(
      migrationPatterns.migrator.test(
        "import { drizzle } from 'drizzle-orm/libsql'"
      )
    ).toEqual(false)
  })

  it('reads a name that merely contains the word as not one', () => {
    expect(
      migrationPatterns.migrator.test('const migrated = migrateRows(rows)')
    ).toEqual(false)
  })
})

describe('migrationArtifactPath', () => {
  it('names the folder a generated migration sits in', () => {
    expect(migrationArtifactPath('drizzle/0000_graceful_whizzer.sql')).toEqual(
      'drizzle'
    )
  })

  it('names the generator config as its own artifact', () => {
    expect(migrationArtifactPath('drizzle.config.ts')).toEqual(
      'drizzle.config.ts'
    )
  })

  // `out` in the config decides where the folder goes, and pointing it under
  // `src` is ordinary. Reading only the top of the tree made that invisible.
  it('names a folder the config pointed somewhere deeper', () => {
    expect(
      migrationArtifactPath('src/database/drizzle/0000_graceful_whizzer.sql')
    ).toEqual('src/database/drizzle')
  })

  it('says nothing about an ordinary source file', () => {
    expect(migrationArtifactPath('src/database/tables.ts')).toEqual(undefined)
  })
})

// The app creates its tables at boot from `src/database/tables.ts` and then
// reconciles columns; no migration is ever executed. A `drizzle/` folder and a
// `drizzle-kit` dependency sat in the tree anyway for nine months, drifting
// until the committed SQL created a table that exists nowhere and omitted five
// that do — while `CONTRIBUTING.md` told new contributors to regenerate it.
//
// Nothing observes files that nothing imports, which is why it went unnoticed
// for so long and why this check has to be so literal.
describe('the migration tooling in this repository', () => {
  function tracked(...pathspecs: string[]): string[] {
    return execFileSync('git', ['ls-files', ...pathspecs], {
      cwd: repositoryRoot,
      encoding: 'utf-8',
      timeout: 15_000
    })
      .split('\n')
      .filter((line) => line.length > 0)
  }

  // Committed rather than merely present, because what drifts is SQL that is in
  // the tree for everyone; and recognised by name at any depth rather than
  // from a list of the paths that happened to exist when this was written,
  // because `drizzle-kit` writes where its config points it. What that does
  // and does not reach is `migrationArtifactPath`.
  //
  // One walk, shared with the non-vacuity check below. Two calls let this one
  // be narrowed to nothing while the other went on proving the tree was read.
  const trackedFiles = tracked()

  const artifacts = [
    ...new Set(
      trackedFiles
        .map(migrationArtifactPath)
        .filter((entry) => entry !== undefined)
    )
  ].sort()

  const manifest = JSON.parse(
    readFileSync(join(repositoryRoot, 'package.json'), 'utf-8')
  ) as {
    dependencies: Record<string, string>
    devDependencies: Record<string, string>
  }

  const dependencies = [
    ...Object.keys(manifest.dependencies),
    ...Object.keys(manifest.devDependencies)
  ].filter((name) => migrationPatterns.generator.test(name))

  // Tests excluded, because applying a migration in a test is not applying
  // it at boot — and because this file names the migrator import in a
  // fixture, which made the guard's own test the applier that excused
  // everything else. It passed on a repository with the artifacts restored.
  const sourceFiles = tracked('src/*.ts', 'src/*.tsx').filter(
    (file) => !/\.test\.tsx?$/.test(file)
  )

  function sourceFilesMatching(pattern: RegExp): string[] {
    return sourceFiles.filter((file) =>
      pattern.test(readFileSync(join(repositoryRoot, file), 'utf-8'))
    )
  }

  const appliers = sourceFilesMatching(migrationPatterns.migrator)

  // The empty answer below has two causes, and only one of them is this
  // repository's: there is nothing to find. The other is an applier, which
  // excuses every artifact in the tree without saying so. Nothing under `src`
  // imports drizzle's migrator today, and that is asserted rather than
  // assumed, because it is the half a stray line switches off.
  it('has nothing applying a migration to excuse what it finds', () => {
    expect(
      appliers,
      'Something under `src` now imports the drizzle migrator. If that is a real migration system then the check below is satisfied by it rather than by an empty tree, and should say so. If it is not one, the check below is switched off.'
    ).toEqual([])
  })

  it('is applied by something, or is not there', () => {
    expect(
      unappliedMigrationTooling({ appliers, artifacts, dependencies }),
      'These generate migrations that nothing under `src` executes, so the SQL they produce is documentation that drifts. Either wire a drizzle migrator into the boot path, or delete them — and strike any instruction to regenerate them from CONTRIBUTING.md.'
    ).toEqual([])
  })

  // An empty answer above is what a healthy repository looks like and also what
  // a guard that has stopped reading anything looks like. These are what tell
  // them apart — each half of the scan asked for something that is there, so a
  // walk that returns nothing, a read that returns nothing, and a manifest that
  // parsed to nothing all fail here instead of passing as good news.
  it('is read from the repository rather than assumed', () => {
    expect({
      // `drizzle-orm` is imported throughout `src`; the migrator subpath is
      // not. Same walk, same read, a pattern that must match.
      findsSourceItIsLookingFor: sourceFilesMatching(/drizzle-orm/).length > 0,
      // This file quotes a migrator import as a fixture further up, so it has
      // to stay outside the scan. When it did not, it was itself the applier
      // that excused every artifact in the tree, and the guard passed on a
      // repository with the whole `drizzle/` folder restored. The property is
      // asserted, not the one filename: narrowing the exclusion to this file
      // alone leaves the next test that quotes an import free to do it again.
      leavesEveryTestFileOut: sourceFiles.every(
        (file) => !/\.test\.tsx?$/.test(file)
      ),
      // The artifact scan is a filter over the tracked tree, so this is the
      // half of it that has to have found something: an entry it could have
      // named, had the name matched.
      namesTheTree: trackedFiles.some((file) => file === 'package.json'),
      parsesTheManifest: Object.keys(manifest.devDependencies).length > 0
    }).toEqual({
      findsSourceItIsLookingFor: true,
      leavesEveryTestFileOut: true,
      namesTheTree: true,
      parsesTheManifest: true
    })
  })
})
