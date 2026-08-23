import { createHash } from 'crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import invariant from 'tiny-invariant'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  mysqlSeedArguments,
  mysqlSeedCommand,
  pipeFileToCommand
} from './mysql-seed'

function sha1(contents: string): string {
  return createHash('sha1').update(contents).digest('hex')
}

// Writes whatever it is given on standard input to the path it is passed.
const copyStdinTo = [
  '-e',
  'require("fs").writeFileSync(process.argv[1], require("fs").readFileSync(0))'
]

// A real child process reading real bytes off its own standard input. Mocking
// the spawn would have passed against the shell pipeline this replaces, which
// is exactly the thing that does not work.
describe('pipeFileToCommand', () => {
  let directory = ''
  let pathVariable = process.env.PATH

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'squeal-seed-'))
    pathVariable = process.env.PATH
  })

  afterEach(() => {
    process.env.PATH = pathVariable

    rmSync(directory, { force: true, recursive: true })
  })

  // The seed corpus really does contain `1. sakila-schema.sql`, and the space
  // in that name is why the old command had to quote the path it interpolated
  // into a shell string. Handing the bytes over directly means no quoting to
  // get wrong.
  it('sends a file whose name contains a space on standard input', async () => {
    const source = join(directory, '1. sakila-schema.sql')
    const destination = join(directory, 'received.sql')
    const contents = [
      'DELIMITER ;;',
      "CREATE PROCEDURE grüss() BEGIN SELECT 'a | b';; END;;",
      'DELIMITER ;',
      ''
    ].join('\n')

    writeFileSync(source, contents, 'utf-8')

    await pipeFileToCommand(
      process.execPath,
      [...copyStdinTo, destination],
      source
    )

    expect(readFileSync(destination, 'utf-8')).toEqual(contents)
  })

  // 3.4 MB of it arrives whole. `cat` streamed; this does not, and a pipe that
  // silently truncated at its buffer size would still look like a working seed
  // until a table came up short.
  it('sends a file larger than a pipe buffer', async () => {
    const source = join(directory, 'large.sql')
    const destination = join(directory, 'received.sql')
    const contents = 'INSERT INTO film VALUES (1);\n'.repeat(200_000)

    writeFileSync(source, contents, 'utf-8')

    await pipeFileToCommand(
      process.execPath,
      [...copyStdinTo, destination],
      source
    )

    expect(sha1(readFileSync(destination, 'utf-8'))).toEqual(sha1(contents))
  })

  // The whole bug: `cat "<file>" | <command>` is a shell command, and
  // `execSync` runs it through `process.env.ComSpec` — cmd.exe — which has no
  // `cat`. An empty PATH is what that shell sees on a Windows machine that did
  // not put Git's `usr\bin` on it, which is the default. This is the one
  // assertion here that fails if the pipeline ever comes back.
  it('needs nothing on the PATH but the command itself', async () => {
    const source = join(directory, 'seed.sql')
    const destination = join(directory, 'received.sql')

    writeFileSync(source, 'SELECT 1;\n', 'utf-8')

    process.env.PATH = ''

    await pipeFileToCommand(
      process.execPath,
      [...copyStdinTo, destination],
      source
    )

    expect(readFileSync(destination, 'utf-8')).toEqual('SELECT 1;\n')
  })

  // `runSeedFiles` runs the files in order, and `seed()` stops on the first
  // rejection, so a statement the server refuses must not be reported as a
  // completed step.
  //
  // The cases below are the four ways this actually fails, and each has a
  // different thing to tell the developer, so each is checked against the
  // message it produces rather than against "it threw". Raw, the first two read
  // `Command failed: docker exec -i squeal-mysql mysql -uroot -pmysql` and
  // `spawnSync docker EOF` — neither names the file, and the second names
  // nothing at all.
  it('says which file failed and what the exit status was', async () => {
    const source = join(directory, 'broken.sql')

    writeFileSync(source, 'SELECT 1;\n', 'utf-8')

    await expect(
      pipeFileToCommand(process.execPath, ['-e', 'process.exit(3)'], source)
    ).rejects.toThrow(
      `Could not send broken.sql to \`${process.execPath}\`: it exited with status 3.`
    )
  })

  // The case the small file above cannot reach. Past the pipe buffer it is the
  // parent's write that fails, so Node reports `EOF` and drops the status — and
  // this is the failure a developer meets first, because it is what a container
  // that is not up yet produces on a 3.4 MB file. The command here exits zero:
  // a load can be incomplete without the command reporting anything wrong.
  it('says the load is incomplete when the command stops reading', async () => {
    const source = join(directory, 'large.sql')

    writeFileSync(source, 'SELECT 1;\n'.repeat(20_000), 'utf-8')

    await expect(
      pipeFileToCommand(process.execPath, ['-e', 'process.exit(0)'], source)
    ).rejects.toThrow(
      `Could not send large.sql to \`${process.execPath}\`: it stopped reading before the whole file was sent, so the load is incomplete. That usually means it rejected a statement, or the server is not accepting connections yet.`
    )
  })

  // What a machine without Docker gets. libuv's own path search tries the
  // literal name plus `.com` and `.exe`, never `.cmd`, so this is also what a
  // `docker` exposed only as a shim would produce.
  it('says the command was not found when it is not installed', async () => {
    const source = join(directory, 'seed.sql')

    writeFileSync(source, 'SELECT 1;\n', 'utf-8')

    await expect(
      pipeFileToCommand('squeal-no-such-command', [], source)
    ).rejects.toThrow(
      'Could not send seed.sql to `squeal-no-such-command`: the command was not found — check that it is installed and on your PATH.'
    )
  })

  it('says so when the command never finishes', async () => {
    const source = join(directory, 'seed.sql')

    writeFileSync(source, 'SELECT 1;\n', 'utf-8')

    await expect(
      pipeFileToCommand(
        process.execPath,
        ['-e', 'setTimeout(() => {}, 30000)'],
        source,
        300
      )
    ).rejects.toThrow(
      `Could not send seed.sql to \`${process.execPath}\`: it did not finish within 300ms.`
    )
  })

  // The original error is the only place the exit status and the raw output
  // survive, and nothing above would notice if it stopped being attached.
  it('keeps the original failure as the cause', async () => {
    const source = join(directory, 'broken.sql')

    writeFileSync(source, 'SELECT 1;\n', 'utf-8')

    const failure = await pipeFileToCommand(
      process.execPath,
      ['-e', 'process.exit(3)'],
      source
    ).catch((error: unknown) => error as Error)

    // `.catch` widens the result to include the `void` the call resolves with,
    // so this is what stands between a pipe that stopped rejecting and a
    // TypeError on `undefined.cause` — which would report the wrong thing.
    invariant(failure, 'Piping to a command that exits 3 should have rejected.')

    expect((failure.cause as { status: number }).status).toEqual(3)
  })
})

// The container name and the root password are Compose's, not the seed script's
// — the script only borrows them, and nothing checks that the two agree. Rename
// the service and `yarn seed` fails with a message about a container that does
// not exist. This is drift detection, not one source of truth; MySQL still has
// no environment override the way Postgres and SQLite do.
describe('the MySQL seed command', () => {
  // The carriage returns go because the repository is checked out with CRLF
  // on Windows and the block below is matched line by line.
  const compose = readFileSync(
    join(import.meta.dirname, '..', 'docker-compose.yml'),
    'utf-8'
  ).replace(/\r/g, '')

  // Only the `mysql:` block, so a `container_name` belonging to Postgres cannot
  // stand in for a missing one here. The service ends where the next key at the
  // same indentation begins.
  const mysqlService = /\n {2}mysql:\n(?: +\S.*\n|\n)*/.exec(compose)?.[0]

  // Without this the assertion below compares against `-pundefined`, which
  // fails — but says the seed command is wrong rather than that the service was
  // renamed out from under it.
  it('finds the mysql service to compare against', () => {
    expect(mysqlService).toEqual(expect.stringContaining('image: mysql'))
  })

  it('addresses the container docker-compose.yml declares', () => {
    invariant(mysqlService, 'docker-compose.yml declares no mysql service.')

    const containerName = /container_name: "?([^"\n]+?)"?\n/.exec(
      mysqlService
    )?.[1]
    const rootPassword = /MYSQL_ROOT_PASSWORD: "?([^"\n]+?)"?\n/.exec(
      mysqlService
    )?.[1]

    expect([mysqlSeedCommand, ...mysqlSeedArguments]).toEqual([
      'docker',
      'exec',
      '-i',
      containerName,
      'mysql',
      '-uroot',
      `-p${rootPassword}`
    ])
  })
})
