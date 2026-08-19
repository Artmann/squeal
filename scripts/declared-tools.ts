/**
 * Which command-line tools a shell command reaches for, so a guard test can
 * check that every one of them is a package this repository declares a version
 * for.
 */

/**
 * Commands the machine running the build already has. A package.json that does
 * not declare them is not the defect. `npx` is on the list because what it
 * fetches is the interesting part, not `npx` itself.
 */
const runtimeCommands = ['bun', 'node', 'npm', 'npx', 'yarn']

/** `&&`, `||`, a pipe, a semicolon or a newline all start a new command. */
const segmentSeparator = /&&|\|\||[|;\n]/

/** An assignment prefix, as in `NODE_ENV=test vitest run`. */
const assignmentPrefix = /^[A-Za-z_][A-Za-z0-9_]*=/

/**
 * The commands yarn answers itself rather than looking up in `scripts`. Read as
 * scripts they would be reported as missing, since package.json declares no
 * such thing and never should.
 *
 * The lockfile is `yarn lockfile v1`, so this is that version's list rather
 * than a guess at another's. What no list can cover is yarn's other fallback:
 * `yarn prettier` runs the bin from node_modules when no script matches it, so
 * a workflow written that way is reported as a script package.json is missing.
 * Moving it into a script is the fix, and the one this guard exists to ask for.
 */
const yarnCommands = [
  'access',
  'add',
  'audit',
  'autoclean',
  'bin',
  'cache',
  'check',
  'config',
  'create',
  'dedupe',
  'generate-lock-entry',
  'global',
  'help',
  'import',
  'info',
  'init',
  'install',
  'licenses',
  'link',
  'list',
  'login',
  'logout',
  'node',
  'outdated',
  'owner',
  'pack',
  'policies',
  'publish',
  'remove',
  'tag',
  'team',
  'unlink',
  'unplug',
  'upgrade',
  'upgrade-interactive',
  'version',
  'versions',
  'why',
  'workspace',
  'workspaces'
]

/** The shape of a package.json script name. */
const scriptName = /^[A-Za-z][A-Za-z0-9:_-]*$/

/**
 * Whether an `npx` specifier names the version it runs, which is what declaring
 * it would have achieved. A leading `@` is a scope, not a version, so only a
 * later one counts — and `name@latest` is not a version but the float this
 * guard exists to catch, so it is not pinned.
 */
function isPinned(specifier: string): boolean {
  const separator = specifier.lastIndexOf('@')

  return separator > 0 && /^[~^><=]*\d/.test(specifier.slice(separator + 1))
}

/**
 * What an `npx` invocation would fetch, which is not always the first argument
 * that is not an option: `--package=name` names the package, and the command
 * after it is a bin inside that package — a bin name is not what a dependency
 * list declares. The spaced spellings, `-p name` and `--package name`, need no
 * handling of their own, since the package is then the first non-option token
 * anyway.
 */
function npxSpecifier(argumentTokens: readonly string[]): string | undefined {
  const inline = argumentTokens.find((token) => token.startsWith('--package='))

  if (inline !== undefined) {
    return inline.slice('--package='.length)
  }

  return argumentTokens.find((token) => !token.startsWith('-'))
}

/**
 * The tool an `npx` invocation would fetch, given the arguments after `npx`,
 * or `undefined` when the invocation says for itself which version it runs. A
 * pinned invocation stays on no list under the name it was written with, which
 * no declared package provides.
 */
function npxTool(argumentTokens: readonly string[]): string | undefined {
  const specifier = npxSpecifier(argumentTokens)

  if (specifier === undefined || isPinned(specifier)) {
    return undefined
  }

  return specifier
}

function tokenize(segment: string): string[] {
  return segment
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0)
}

interface Invocations {
  /** The `scripts` block of a package.json, command lines and all. */
  readonly scripts: Record<string, string>
  /** The contents of each workflow file. */
  readonly workflows: readonly string[]
}

/**
 * Every tool the repository invokes, from both of the places it invokes one.
 */
export function invokedTools(invocations: Invocations): string[] {
  const tools = [
    ...Object.values(invocations.scripts).flatMap(toolsInvokedByScript),
    ...invocations.workflows.flatMap(unpinnedNpxTools)
  ]

  return [...new Set(tools)].sort()
}

/**
 * Every package an `npx` invocation in a block of shell names, pinned or not.
 *
 * Separate from `unpinnedNpxTools` because a repository that has pinned every
 * one of its invocations gives that function nothing to return, and an empty
 * result then cannot be told apart from a scan that has stopped matching. This
 * answers what the scan saw rather than what it rejected, which is the form of
 * the question that still has an answer.
 */
export function npxSpecifiers(shell: string): string[] {
  const specifiers = [...shell.matchAll(/\bnpx\b([^\n&|;]*)/g)].flatMap(
    (match) => {
      const specifier = npxSpecifier(tokenize(match[1]))

      return specifier === undefined ? [] : [specifier]
    }
  )

  return [...new Set(specifiers)].sort()
}

/** Every tool a package.json script runs, in each segment of a chain. */
export function toolsInvokedByScript(script: string): string[] {
  const tools = script.split(segmentSeparator).flatMap((segment) => {
    const tokens = tokenize(segment)
    const commandIndex = tokens.findIndex(
      (token) => !assignmentPrefix.test(token)
    )

    if (commandIndex === -1) {
      return []
    }

    const command = tokens[commandIndex]

    if (!runtimeCommands.includes(command)) {
      return [command]
    }

    if (command !== 'npx') {
      return []
    }

    const tool = npxTool(tokens.slice(commandIndex + 1))

    return tool === undefined ? [] : [tool]
  })

  return [...new Set(tools)].sort()
}

/** Every unpinned `npx` invocation anywhere in a block of shell. */
export function unpinnedNpxTools(shell: string): string[] {
  return npxSpecifiers(shell).filter((specifier) => !isPinned(specifier))
}

/**
 * Every package.json script a block of shell asks yarn to run.
 *
 * Scanned over the whole block rather than over its `run:` values, because a
 * `run:` may be a block scalar whose commands are on the lines below it, and a
 * line-oriented scan would quietly cover none of them. What that costs is the
 * prose: a comment quoting `yarn make:mac` reads as an invocation. It is the
 * shape of a script name that rules those out — the backticks a comment quotes
 * with are not part of one, and a first token that cannot be a script name ends
 * the invocation rather than passing the search along to the next word, which
 * would report the sentence's own vocabulary.
 */
export function yarnScripts(shell: string): string[] {
  const scripts = [...shell.matchAll(/\byarn\b([^\n&|;]*)/g)].flatMap(
    (match) => {
      const tokens = tokenize(match[1]).filter(
        (token) => !token.startsWith('-')
      )
      const command = tokens[0] === 'run' ? tokens[1] : tokens[0]

      if (command === undefined || !scriptName.test(command)) {
        return []
      }

      return yarnCommands.includes(command) ? [] : [command]
    }
  )

  return [...new Set(scripts)].sort()
}
