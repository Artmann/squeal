import { execFileSync } from 'child_process'
import { readFile } from 'fs/promises'

/** The container `docker-compose.yml` declares, and the credentials it sets. */
export const mysqlSeedCommand = 'docker'
export const mysqlSeedArguments = [
  'exec',
  '-i',
  'squeal-mysql',
  'mysql',
  '-uroot',
  '-pmysql'
]

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
  filePath: string
): Promise<void> {
  const contents = await readFile(filePath)

  execFileSync(command, commandArguments, {
    // `input` requires a piped stdin — anything else is a TypeError. The other
    // two stay inherited so the server's own output reaches the terminal.
    input: contents,
    stdio: ['pipe', 'inherit', 'inherit']
  })
}
