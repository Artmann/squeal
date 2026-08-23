import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

import {
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
  // the tree for everyone; and found by name rather than from a list of the
  // paths that happened to exist when this was written, because `drizzle-kit`
  // writes wherever its config points it.
  const artifacts = [...new Set(tracked().map((file) => file.split('/')[0]))]
    .filter((entry) => migrationPatterns.artifact.test(entry))
    .sort()

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
      // repository with the whole `drizzle/` folder restored.
      leavesItsOwnFixtureOut: !sourceFiles.includes(
        'src/database/migration-tooling.test.ts'
      ),
      // The artifact scan is a filter over the tracked tree, so this is the
      // half of it that has to have found something: a top-level entry it could
      // have named, had the name matched.
      namesTheTopLevelTree: tracked().some(
        (file) => file.split('/')[0] === 'package.json'
      ),
      parsesTheManifest: Object.keys(manifest.devDependencies).length > 0
    }).toEqual({
      findsSourceItIsLookingFor: true,
      leavesItsOwnFixtureOut: true,
      namesTheTopLevelTree: true,
      parsesTheManifest: true
    })
  })
})
