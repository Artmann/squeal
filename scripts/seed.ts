import { execSync } from 'child_process'
import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { Client } from 'pg'

const POSTGRES_URL =
  process.env.POSTGRES_URL ??
  'postgresql://postgres:postgres@localhost:5432/squeal'

async function seedPostgres() {
  const client = new Client({ connectionString: POSTGRES_URL })

  try {
    await client.connect()

    console.log('Connected to PostgreSQL')

    console.log('Resetting public schema...')
    await client.query('DROP SCHEMA public CASCADE')
    await client.query('CREATE SCHEMA public')
    console.log('  ✓ Schema reset\n')

    const seedDirectory = join(__dirname, '..', 'seed')
    const files = await readdir(seedDirectory)
    const sqlFiles = files.filter((file) => file.endsWith('.sql')).sort()

    console.log(`Found ${sqlFiles.length} PostgreSQL seed files\n`)

    for (const file of sqlFiles) {
      console.log(`Running: ${file}`)

      const sql = await readFile(join(seedDirectory, file), 'utf-8')

      await client.query(sql)

      console.log(`  ✓ Complete\n`)
    }

    console.log('PostgreSQL seeded successfully!\n')
  } finally {
    await client.end()
  }
}

async function seedMysql() {
  console.log('Connected to MySQL')

  const seedDirectory = join(__dirname, '..', 'seed-mysql')
  const files = await readdir(seedDirectory)
  const sqlFiles = files.filter((file) => file.endsWith('.sql')).sort()

  console.log(`Found ${sqlFiles.length} MySQL seed files\n`)

  for (const file of sqlFiles) {
    console.log(`Running: ${file}`)

    const filePath = join(seedDirectory, file)

    execSync(
      `cat "${filePath}" | docker exec -i squeal-mysql mysql -uroot -pmysql`,
      { stdio: 'inherit' }
    )

    console.log(`  ✓ Complete\n`)
  }

  console.log('MySQL seeded successfully!\n')
}

async function seed() {
  try {
    await seedPostgres()
    await seedMysql()

    console.log('All databases seeded successfully!')
  } catch (error) {
    console.error('Error seeding database:', error)

    process.exit(1)
  }
}

seed()
