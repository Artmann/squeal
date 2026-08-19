import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  mysqlSeedArguments,
  mysqlSeedCommand,
  pipeFileToCommand
} from './mysql-seed'

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

    expect(readFileSync(destination, 'utf-8').length).toEqual(contents.length)
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
  it('fails when the command does', async () => {
    const source = join(directory, 'broken.sql')

    writeFileSync(source, 'SELECT 1;\n', 'utf-8')

    await expect(
      pipeFileToCommand(process.execPath, ['-e', 'process.exit(3)'], source)
    ).rejects.toThrow()
  })
})

describe('the MySQL seed command', () => {
  // The container name and the root password are Compose's, not the seed
  // script's — the script only borrows them. Renaming the service or changing
  // the password otherwise breaks `yarn seed` with a message about a container
  // that does not exist.
  it('addresses the container docker-compose.yml declares', () => {
    const compose = readFileSync(
      join(import.meta.dirname, '..', 'docker-compose.yml'),
      'utf-8'
    )
    const mysqlService = compose.slice(compose.indexOf('\n  mysql:'))
    const containerName = /container_name: (\S+)/.exec(mysqlService)?.[1]
    const rootPassword = /MYSQL_ROOT_PASSWORD: (\S+)/.exec(mysqlService)?.[1]

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
