import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { pathToFileURL } from 'url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

interface SeedTargets {
  postgresUrl: string
  sqlitePath: string
}

const requireFromTest = createRequire(import.meta.url)
const repositoryRoot = join(import.meta.dirname, '..')
const seedConfig = pathToFileURL(join(import.meta.dirname, 'seed-config.ts'))
const seedScript = join(import.meta.dirname, 'seed.ts')
const tsxCli = requireFromTest.resolve('tsx/cli')

// The default SQLite target, spelled out here so the cases below can compare a
// whole path. Asserting only its last two segments would let the seed write to
// the repository's parent, or into `scripts/`, unnoticed.
const defaultSqlitePath = join(repositoryRoot, 'seed-sqlite', 'pagila.sqlite')

// RFC 2606 reserves `.invalid` and guarantees it never resolves, so pointing
// the seed at it cannot reach a server. That, plus `seedPostgres` connecting
// before it issues a statement, is what makes running the real script here safe.
const unreachableHost = 'nowhere.invalid'

let directory = ''

/**
 * `process.env` with everything that would decide the answer for us removed.
 *
 * The two targets go because leaving an already-set variable alone is the whole
 * reason a shell export still beats `.env` — so whatever the developer running
 * the suite happens to export would otherwise win every case here.
 * `DOTENV_CONFIG_*` goes because it configures dotenv itself, and
 * `DOTENV_CONFIG_QUIET=false` puts a banner on the child's stdout.
 */
function childEnvironment(
  overrides: Record<string, string>
): NodeJS.ProcessEnv {
  const environment = { ...process.env, ...overrides }
  const scrubbed = Object.keys(environment).filter(
    (name) =>
      name === 'POSTGRES_URL' ||
      name === 'SQLITE_PATH' ||
      name.startsWith('DOTENV_CONFIG_')
  )

  for (const name of scrubbed) {
    if (!(name in overrides)) {
      delete environment[name]
    }
  }

  return environment
}

/**
 * Load the targets in a directory, and under the loader `yarn seed` really runs
 * on.
 *
 * A child process rather than an import, for two reasons. `.env` is read once,
 * as `dotenv` is first loaded, and `vi.resetModules()` does not reach a module
 * from `node_modules` — so in-process only the first case here would have
 * measured anything and the rest would have read a stale cache. And `tsx` loads
 * this repository as CommonJS, which is why `seed-config.ts` cannot use
 * `import.meta.dirname`; running it any other way would not catch that.
 */
function resolveTargets(overrides: Record<string, string> = {}): SeedTargets {
  const printer = join(directory, 'print-targets.ts')

  writeFileSync(
    printer,
    [
      `import { postgresUrl, sqlitePath } from ${JSON.stringify(seedConfig.href)}`,
      '',
      'console.log(JSON.stringify({ postgresUrl, sqlitePath }))',
      ''
    ].join('\n'),
    'utf-8'
  )

  const output = execFileSync(process.execPath, [tsxCli, printer], {
    cwd: directory,
    encoding: 'utf-8',
    env: childEnvironment(overrides),
    timeout: 60_000
  })

  // The last line rather than all of stdout. Anything else printed on the way —
  // a dotenv banner after a version bump, a `console.log` someone adds to the
  // seed — would otherwise turn every case in this file red with a JSON parse
  // error naming neither the seed nor the cause.
  const printed = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .at(-1)

  if (printed === undefined) {
    throw new Error(
      'Loading the seed targets printed nothing at all, so there is nothing to check. Run `npx tsx scripts/seed-config.ts` to see what the module does on load.'
    )
  }

  return JSON.parse(printed) as SeedTargets
}

/** Run the seed itself, from `directory`, and return everything it said. */
function runSeed(overrides: Record<string, string>): string {
  // Structural rather than per-case. With nothing setting `SQLITE_PATH` the
  // seed falls back to the repository's own `seed-sqlite/pagila.sqlite` — the
  // developer's sample database, which `seedSqlite` deletes before it writes.
  // One case here that forgets to point it somewhere else is enough to lose
  // that file, and the case would still pass.
  const target = resolveTargets(overrides).sqlitePath

  if (!resolve(directory, target).startsWith(resolve(directory))) {
    throw new Error(
      `This case would run the seed against '${target}', which is outside the temporary directory it was given. Point SQLITE_PATH — in the case's \`.env\` or in its overrides — at a path under it.`
    )
  }

  try {
    execFileSync(process.execPath, [tsxCli, seedScript], {
      cwd: directory,
      encoding: 'utf-8',
      env: childEnvironment(overrides),
      stdio: 'pipe',
      timeout: 60_000
    })
  } catch (error) {
    const failure = error as { stderr?: string; stdout?: string }

    return `${failure.stdout ?? ''}${failure.stderr ?? ''}`
  }

  throw new Error(
    'The seed ran to completion against a host that cannot resolve, which means it connected to something else. Check where `scripts/seed.ts` reads `POSTGRES_URL` from.'
  )
}

function writeDotEnv(...lines: string[]): void {
  writeFileSync(join(directory, '.env'), `${lines.join('\n')}\n`, 'utf-8')
}

// `yarn seed` drops and recreates schemas, so where it points has to be where
// the developer asked it to point. `.env` is where CONTRIBUTING says to ask.
//
// The resolution lives in a module of its own so that most of this file can
// exist: importing `seed.ts` runs the seed, and `sqlitePath` is unreachable
// through the script anyway, because `seedPostgres` fails first and
// `seedSqlite` is never called. The last case here does run the real script —
// connecting is not itself the destructive act, so a host that cannot resolve
// observes the whole bug without touching a database.
describe('the seed targets', () => {
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'squeal-seed-env-'))
  })

  afterEach(() => {
    rmSync(directory, { force: true, recursive: true })
  })

  it('takes both targets from .env', () => {
    writeDotEnv(
      'POSTGRES_URL=postgresql://someone@example.test:6000/other',
      'SQLITE_PATH=./elsewhere/pagila.sqlite'
    )

    expect(resolveTargets()).toEqual({
      postgresUrl: 'postgresql://someone@example.test:6000/other',
      sqlitePath: './elsewhere/pagila.sqlite'
    })
  })

  // What the script did before `.env` was read, and still has to do when there
  // is none — the values `.env.example` documents, matching the services in
  // `docker-compose.yml`. Port 5433, not 5432: Compose maps it that way to miss
  // a Postgres already running on the host.
  //
  // The SQLite default is anchored to the repository rather than to the working
  // directory, preserving what `__dirname` did before the extraction. Under
  // `yarn seed` the two are always the same, since yarn runs scripts from the
  // package root wherever it was invoked from; they part company under a bare
  // `npx tsx scripts/seed.ts`, and the sample database lands somewhere else.
  it('falls back to the docker-compose defaults without a .env', () => {
    expect(resolveTargets()).toEqual({
      postgresUrl: 'postgresql://postgres:postgres@localhost:5433/squeal',
      sqlitePath: defaultSqlitePath
    })
  })

  // `POSTGRES_URL=` with nothing after it is a half-finished edit, and dotenv
  // sets it to the empty string rather than leaving it unset — measured. Under
  // `||` that is falsy and the default wins, so the script would announce
  // "Connected to PostgreSQL" and drop the schema on 5433, which is the exact
  // failure this change exists to prevent. `??` keeps the empty string and the
  // connection fails instead.
  it('does not fall back when the override is set but empty', () => {
    writeDotEnv('POSTGRES_URL=')

    expect(resolveTargets()).toEqual({
      postgresUrl: '',
      sqlitePath: defaultSqlitePath
    })
  })

  // What keeps CI, and a deliberate one-off override, winning over a stale
  // `.env` left in the tree. It is dotenv's documented behaviour rather than
  // anything this module does, and it is asserted because the point of the
  // change is that `.env` now decides something destructive.
  it('lets the surrounding environment win over .env', () => {
    writeDotEnv('POSTGRES_URL=postgresql://someone@example.test:6000/other')

    expect(
      resolveTargets({
        POSTGRES_URL: 'postgresql://shell@example.test:7000/shell'
      })
    ).toEqual({
      postgresUrl: 'postgresql://shell@example.test:7000/shell',
      sqlitePath: defaultSqlitePath
    })
  })

  // Everything above tests the module the seed imports, and none of it reaches
  // the seed. Putting the two inline `process.env` reads back at the top of
  // `seed.ts` is issue #72 restored in full — `.env` ignored again, the schema
  // on 5433 dropped again — and every case above stays green through it. This
  // is the one that goes red.
  it('points the seed itself at the server .env names', () => {
    writeDotEnv(
      `POSTGRES_URL=postgresql://postgres:postgres@${unreachableHost}:5433/squeal`
    )

    expect(
      runSeed({ SQLITE_PATH: join(directory, 'pagila.sqlite') })
    ).toContain(unreachableHost)
  })

  // `14` is `SQLITE_CANTOPEN`, and the message libsql raises says only that:
  // no mention of `SQLITE_PATH`, of `.env`, or of the directory being the
  // thing that is missing. The reader has to know libsql's error codes are
  // SQLite's and go look up the number.
  //
  // The check runs before `seedPostgres`, which is why the Postgres in this
  // `.env` is one that cannot resolve and the assertion says the output does
  // not mention it. Config that is wrong should be caught before the seed
  // drops a schema, not after.
  it('names SQLITE_PATH when the directory it points into is missing', () => {
    const missingDirectory = join(directory, 'no-such-dir')
    const missingPath = join(missingDirectory, 'pagila.sqlite')

    writeDotEnv(
      `POSTGRES_URL=postgresql://postgres:postgres@${unreachableHost}:5433/squeal`,
      `SQLITE_PATH=${missingPath}`
    )

    const output = runSeed({})

    expect({
      beforeTouchingPostgres: !output.includes(unreachableHost),
      // Quoted on its own, not merely present. The path the seed would have
      // written starts with the missing directory, so a message naming only
      // that path already contains it as a substring while leaving the reader
      // to work out which segment is the part that is not there. Only a
      // message that names the directory by itself closes the quote here.
      namesTheDirectory: output.includes(`'${missingDirectory}'`),
      namesTheSource: output.includes('SQLITE_PATH'),
      // A phrase, which is as close as a test gets to "the message says what
      // to do about it": there is no shape to look for, only the instruction
      // itself. So rewording it turns this red even when the rewording is an
      // improvement — a cost taken knowingly, because the alternative is a
      // message that can quietly stop saying anything actionable.
      saysWhatToDo: output.includes('Create the directory')
    }).toEqual({
      beforeTouchingPostgres: true,
      namesTheDirectory: true,
      namesTheSource: true,
      saysWhatToDo: true
    })
  })

  // `existsSync` answers for a file as readily as for a directory, so a
  // `SQLITE_PATH` one segment too deep — the sample database itself taken for
  // the directory to put it in — walks straight past the check and reaches
  // libsql, which fails with the bare `14` the check exists to replace.
  it('names SQLITE_PATH when what it points into is a file', () => {
    const file = join(directory, 'not-a-directory')

    writeFileSync(file, '', 'utf-8')
    writeDotEnv(
      `POSTGRES_URL=postgresql://postgres:postgres@${unreachableHost}:5433/squeal`,
      `SQLITE_PATH=${join(file, 'pagila.sqlite')}`
    )

    const output = runSeed({})

    expect({
      beforeTouchingPostgres: !output.includes(unreachableHost),
      namesTheSource: output.includes('SQLITE_PATH'),
      namesWhatIsWrong: output.includes(file)
    }).toEqual({
      beforeTouchingPostgres: true,
      namesTheSource: true,
      namesWhatIsWrong: true
    })
  })

  // `.env.example` ships a relative `SQLITE_PATH` and `.env` is read from the
  // working directory, so relative is the shape a developer most likely has.
  // Printed back as written, the message tells someone looking at a repository
  // that visibly contains `seed-sqlite/` that `./seed-sqlite` does not exist,
  // and never says what `./` was resolved against — the same complaint the
  // check makes of libsql, in the other direction.
  it('resolves a relative SQLITE_PATH before naming the directory', () => {
    writeDotEnv(
      `POSTGRES_URL=postgresql://postgres:postgres@${unreachableHost}:5433/squeal`,
      'SQLITE_PATH=./no-such-dir/pagila.sqlite'
    )

    const output = runSeed({})

    expect({
      beforeTouchingPostgres: !output.includes(unreachableHost),
      namesTheResolvedDirectory: output.includes(join(directory, 'no-such-dir'))
    }).toEqual({
      beforeTouchingPostgres: true,
      namesTheResolvedDirectory: true
    })
  })
})
