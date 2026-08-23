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
  /** A path component that holds or configures generated migrations. */
  artifact: /^drizzle/,
  /** A package that exists to generate them. */
  generator: /^drizzle-kit/,
  /**
   * An import of drizzle's migrator entry point, which is the only way to run
   * one. Deliberately not the word "migrate": a `migrateRows` helper would
   * otherwise pass itself off as a migration system.
   *
   * An import rather than the path anywhere in the file, because an applier is
   * the half that excuses the other, so anything that reads as one switches
   * the whole guard off. Prose naming the path — a comment explaining what
   * an applier is, an error message telling someone to write one — would
   * otherwise do exactly that.
   */
  migrator: /(?:from|require\()\s*['"]drizzle-orm\/[^'"]+\/migrator['"]/
}

/**
 * The artifact a tracked path belongs to, or nothing when it belongs to none.
 *
 * At any depth rather than only at the top of the tree, because `drizzle-kit`
 * writes where its config's `out` points it and that is often somewhere under
 * `src`. A folder whose name says nothing about drizzle — `out: './migrations'`
 * — is still invisible, and deliberately so: reading every `.sql` file in the
 * repository to guess whether it was generated is worse than the gap. The
 * pair is caught anyway, because nothing generates into that folder without a
 * `drizzle.config.*` that this does name.
 */
export function migrationArtifactPath(file: string): string | undefined {
  const parts = file.split('/')
  const depth = parts.findIndex((part) => migrationPatterns.artifact.test(part))

  return depth === -1 ? undefined : parts.slice(0, depth + 1).join('/')
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
