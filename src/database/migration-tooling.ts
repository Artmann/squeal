/**
 * Which of the repository's migration artifacts nothing applies, so a guard
 * test can check that a generated migration cannot sit in the tree describing
 * a schema no code ever reads.
 */

export interface MigrationTooling {
  /** Modules that apply a generated migration at runtime. */
  readonly appliers: readonly string[]
  /** Paths that exist only to hold or configure generated migrations. */
  readonly artifacts: readonly string[]
  /** Packages that exist only to generate them. */
  readonly dependencies: readonly string[]
}

/**
 * How the repository scan recognises each of the three, kept here rather than
 * inline in the test because they are what decides whether the guard ever
 * fires. A pattern that matches too much switches it off — an applier it
 * accepts too readily excuses the artifacts, and an artifact it fails to
 * recognise is one it cannot name — and on a repository with nothing left to
 * find, neither mistake is observable through the guard itself.
 */
export const migrationPatterns = {
  /** A top-level entry that holds or configures generated migrations. */
  artifact: /^drizzle/,
  /** A package that exists to generate them. */
  generator: /^drizzle-kit/,
  /**
   * An import of drizzle's migrator entry point, which is the only way to run
   * one. Deliberately not the word "migrate": a `migrateRows` helper would
   * otherwise pass itself off as a migration system.
   */
  migrator: /drizzle-orm\/[^'"]+\/migrator/
}

/**
 * The artifacts and packages that are kept without an applier, sorted; nothing
 * when there is an applier, and nothing when there is no tooling at all.
 *
 * The pairing is the whole property. Migration tooling on its own is not a
 * defect and neither is a migrator on its own — what goes wrong is generated
 * SQL that nothing executes, because it drifts from the schema silently and
 * still reads to a newcomer as the thing that owns it.
 */
export function unappliedMigrationTooling(tooling: MigrationTooling): string[] {
  if (tooling.appliers.length > 0) {
    return []
  }

  return [...tooling.artifacts, ...tooling.dependencies].sort()
}
