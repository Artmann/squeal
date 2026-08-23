/**
 * Which of the repository's TypeScript files no tsconfig project resolves, so a
 * guard test can check that `yarn typecheck` is as wide as the repository.
 */

export interface TypeScriptProject {
  /** The files `tsc --showConfig` resolved for it. */
  readonly files: readonly string[]
  /** The tsconfig they came from, so a caller can tell the projects apart. */
  readonly name: string
}

/**
 * A path as the comparisons here see it. The same file and the same project get
 * spelled more than one way: `tsc --showConfig` prints what it resolved with a
 * `./` on the front and separators already normalised, `git ls-files` prints
 * neither, and a command line may use either. Left alone, two spellings of one
 * path never match, and the guards answer that every file in the repository is
 * unchecked and that the projects disagree about which projects exist.
 */
export function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '')
}

/**
 * The tsconfig projects a command line checks, in the order it names them.
 *
 * Separate from the references block on purpose: that block is what the editor
 * and the coverage guard read, and it constrains nothing about what CI runs.
 * `yarn typecheck` names each project again on its own command line, and the
 * two drifting apart is the failure this exists to catch — a project that is
 * referenced, resolves files, and is compiled by nothing.
 */
export function typecheckedProjects(script: string): string[] {
  const matches = script.matchAll(/(?:-p|--project)[\s=]+(\S+)/g)

  return [...matches].map((match) => normalize(match[1]))
}

/**
 * The files in `repositoryFiles` that appear in no project, sorted.
 *
 * One pass over the repository rather than one pass per project, so a file
 * missing from all three is named once and there is no set to dedupe after.
 */
export function uncoveredFiles(
  repositoryFiles: readonly string[],
  projects: readonly TypeScriptProject[]
): string[] {
  const covered = new Set(
    projects.flatMap((project) => project.files.map(normalize))
  )

  return repositoryFiles.filter((file) => !covered.has(normalize(file))).sort()
}
