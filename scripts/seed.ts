import { createClient } from '@libsql/client'
import { execSync } from 'child_process'
import { existsSync, unlinkSync } from 'fs'
import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { Client } from 'pg'

const postgresUrl =
  process.env.POSTGRES_URL ??
  'postgresql://postgres:postgres@localhost:5433/squeal'

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

const sqlitePath =
  process.env.SQLITE_PATH ??
  join(__dirname, '..', 'seed-sqlite', 'pagila.sqlite')

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

async function seed() {
  try {
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
