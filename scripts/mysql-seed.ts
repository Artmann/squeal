import { execFileSync } from 'child_process'
import { readFile } from 'fs/promises'
import { basename } from 'path'

/**
 * The container `docker-compose.yml` declares, and the root credentials it
 * sets. Both are repeated from Compose rather than read out of it, so a test
 * asserts the two still agree.
 */
export const mysqlContainer = 'squeal-mysql'
const mysqlRootPassword = 'mysql'

/** `-i` is what keeps the container's standard input open to receive the file. */
export const mysqlSeedArguments = [
  'exec',
  '-i',
  mysqlContainer,
  'mysql',
  '-uroot',
  `-p${mysqlRootPassword}`
]
export const mysqlSeedCommand = 'docker'

/**
 * Long enough that no honest load hits it, short enough that a `docker exec`
 * against a container still initialising its data directory eventually says so
 * instead of hanging until the developer gives up.
 */
const defaultTimeoutMilliseconds = 600_000

/**
 * What went wrong, in the words the developer needs. Every one of these is
 * reached by a real `yarn seed` on a machine where the containers are not up,
 * and none of them is legible in the error Node throws: a small file that the
 * command rejects reads `Command failed: docker exec -i squeal-mysql mysql
 * -uroot -pmysql`, and a large one reads `spawnSync docker EOF`.
 */
function describeFailure(error: unknown, timeoutMilliseconds: number): string {
  const { code, status } = error as { code?: string; status?: number | null }

  if (code === 'ENOENT') {
    return 'the command was not found — check that it is installed and on your PATH.'
  }

  if (code === 'ETIMEDOUT') {
    return `it did not finish within ${timeoutMilliseconds}ms.`
  }

  // The whole file goes to the child in one write, so a child that stops
  // reading fails the parent's write instead of the child. Node reports that as
  // `EOF` and drops the exit status, and it happens whether the command failed
  // or succeeded — so an incomplete load can arrive with status 0.
  if (code === 'EOF') {
    return 'it stopped reading before the whole file was sent, so the load is incomplete. That usually means it rejected a statement, or the server is not accepting connections yet.'
  }

  if (typeof status === 'number' && status !== 0) {
    return `it exited with status ${status}.`
  }

  return `it failed with ${error instanceof Error ? error.message : String(error)}.`
}

/**
 * Run a command with the contents of a file on its standard input.
 *
 * The obvious spelling of this is `cat "<file>" | <command>`, but that is a
 * shell command, and `execSync` runs it through `process.env.ComSpec` — cmd.exe
 * — on Windows, which has no `cat`. Node can hand the bytes over itself. That
 * also spares the path any quoting, which matters here: one of the MySQL seed
 * files is called `1. sakila-schema.sql`.
 *
 * The whole file is read into memory rather than streamed, which `cat` did not
 * do. The largest of them is 3.4 MB.
 */
export async function pipeFileToCommand(
  command: string,
  commandArguments: string[],
  filePath: string,
  timeoutMilliseconds: number = defaultTimeoutMilliseconds
): Promise<void> {
  const contents = await readFile(filePath)

  try {
    execFileSync(command, commandArguments, {
      input: contents,
      // `stdio[0]` has to be `pipe` for `input` to reach the child at all —
      // with `inherit` Node discards it silently and the child reads the
      // terminal, which seeds nothing and can hang forever. The other two stay
      // inherited so the server's own output reaches the developer.
      stdio: ['pipe', 'inherit', 'inherit'],
      timeout: timeoutMilliseconds
    })
  } catch (error) {
    throw new Error(
      `Could not send ${basename(filePath)} to \`${command}\`: ${describeFailure(error, timeoutMilliseconds)}`,
      { cause: error }
    )
  }
}
