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
 * or `undefined` when the invocation says for itself which version it runs.
 */
function npxTool(argumentTokens: readonly string[]): string | undefined {
  const specifier = npxSpecifier(argumentTokens)

  if (specifier === undefined) {
    return undefined
  }

  // `name@3.2.0` carries its own version, which is what declaring it would have
  // achieved. A leading `@` is a scope, not a version, so only a later one
  // counts — and `name@latest` is not a version but the float this guard exists
  // to catch, so it stays on the list under the name it was written with, which
  // no declared package provides.
  const separator = specifier.lastIndexOf('@')
  const version = separator > 0 ? specifier.slice(separator + 1) : undefined

  if (version !== undefined && /^[~^><=]*\d/.test(version)) {
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
  const tools = [...shell.matchAll(/\bnpx\b([^\n&|;]*)/g)].flatMap((match) => {
    const tool = npxTool(tokenize(match[1]))

    return tool === undefined ? [] : [tool]
  })

  return [...new Set(tools)].sort()
}
