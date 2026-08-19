import { createClient } from '@libsql/client'
import { execSync } from 'child_process'
import { existsSync, statSync, unlinkSync } from 'fs'
import { readdir, readFile } from 'fs/promises'
import { dirname, join, resolve } from 'path'
import { pathToFileURL } from 'url'
import { Client } from 'pg'

import { postgresUrl, sqlitePath } from './seed-config'

async function runSeedFiles(
  seedDirectory: string,
  label: string,
  runFile: (filePath: string) => Promise<void>
) {
  const files = await readdir(seedDirectory)
  const sqlFiles = files.filter((file) => file.endsWith('.sql')).sort()

  console.log(`Found ${sqlFiles.length} ${label} seed files\n`)

  for (const file of sqlFiles) {
    console.log(`Running: ${file}`)

    await runFile(join(seedDirectory, file))

    console.log(`  ✓ Complete\n`)
  }
}

async function seedPostgres() {
  const client = new Client({ connectionString: postgresUrl })

  try {
    await client.connect()

    console.log('Connected to PostgreSQL')

    console.log('Resetting public schema...')
    await client.query('DROP SCHEMA public CASCADE')
    await client.query('CREATE SCHEMA public')
    console.log('  ✓ Schema reset\n')

    await runSeedFiles(
      join(__dirname, '..', 'seed'),
      'PostgreSQL',
      async (filePath) => {
        const sql = await readFile(filePath, 'utf-8')

        await client.query(sql)
      }
    )

    console.log('PostgreSQL seeded successfully!\n')
  } finally {
    await client.end()
  }
}

async function seedMysql() {
  console.log('Connected to MySQL')

  await runSeedFiles(
    join(__dirname, '..', 'seed-mysql'),
    'MySQL',
    async (filePath) => {
      execSync(
        `cat "${filePath}" | docker exec -i squeal-mysql mysql -uroot -pmysql`,
        { stdio: 'inherit' }
      )
    }
  )

  console.log('MySQL seeded successfully!\n')
}

async function seedSqlite() {
  console.log('Seeding SQLite database...')

  // Delete existing database file if it exists.
  if (existsSync(sqlitePath)) {
    console.log('Deleting existing SQLite database...')
    unlinkSync(sqlitePath)
    console.log('  ✓ Database deleted\n')
  }

  const client = createClient({ url: pathToFileURL(sqlitePath).toString() })

  try {
    await runSeedFiles(
      join(__dirname, '..', 'seed-sqlite'),
      'SQLite',
      async (filePath) => {
        const sql = await readFile(filePath, 'utf-8')
        const statements = sql
          .split(';')
          .map((statement) => statement.trim())
          .filter((statement) => statement.length > 0)

        for (const statement of statements) {
          await client.execute(statement)
        }
      }
    )

    console.log('SQLite seeded successfully!')
    console.log(`Database created at: ${sqlitePath}\n`)
  } finally {
    client.close()
  }
}

/**
 * Fail on a SQLite target the seed cannot write into.
 *
 * Checked here rather than in `seedSqlite()`, where the path is finally used,
 * because everything between the two drops and recreates a schema — a typo in
 * `.env` is worth catching while the developer's Postgres is still intact.
 *
 * Left to the driver, the seed dies on `createClient` with
 * `ConnectionFailed("Unable to open connection to local database
 * /C:/…/no-such-dir/pagila.sqlite: 14")` — a numeric code, a path wearing the
 * leading slash `pathToFileURL` gave it on Windows, and no mention of either
 * the setting that chose it or which part of it does not exist.
 *
 * The configured path is quoted as it was written and the directory as it
 * resolved, because those are two different things whenever `SQLITE_PATH` is
 * relative — which is the shape `.env.example` ships. Told only that
 * `./seed-sqlite` does not exist, a reader looking at a repository that
 * visibly contains `seed-sqlite/` learns nothing.
 */
function checkSqliteDirectory() {
  const directory = resolve(dirname(sqlitePath))
  const status = statSync(directory, { throwIfNoEntry: false })

  if (status?.isDirectory() === true) {
    return
  }

  // `existsSync` alone would pass a file here, and the seed would go on to ask
  // libsql to open a database under it — the same bare `14`, for a path that
  // looks present.
  const problem =
    status === undefined
      ? `its directory '${directory}' does not exist`
      : `'${directory}' is a file, not the directory it would have to be`

  throw new Error(
    `The SQLite database is set to go to '${sqlitePath}', but ${problem}. Create the directory, or point SQLITE_PATH — from .env, or from your shell if you exported it there — at one that already exists.`
  )
}

async function seed() {
  try {
    checkSqliteDirectory()

    await seedPostgres()
    await seedMysql()
    await seedSqlite()

    console.log('All databases seeded successfully!')
  } catch (error) {
    console.error('Error seeding database:', error)

    process.exit(1)
  }
}

seed()
