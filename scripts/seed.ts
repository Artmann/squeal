import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { Client } from 'pg'

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/squeal'

async function seed() {
  const client = new Client({ connectionString: DATABASE_URL })

  try {
    await client.connect()

    console.log('Connected to database')

    const seedDir = join(__dirname, '..', 'seed')
    const files = await readdir(seedDir)
    const sqlFiles = files.filter((f) => f.endsWith('.sql')).sort()

    console.log(`Found ${sqlFiles.length} seed files\n`)

    for (const file of sqlFiles) {
      console.log(`Running: ${file}`)

      const sql = await readFile(join(seedDir, file), 'utf-8')

      await client.query(sql)

      console.log(`  ✓ Complete\n`)
    }

    console.log('Database seeded successfully!')
  } catch (error) {
    console.error('Error seeding database:', error)

    process.exit(1)
  } finally {
    await client.end()
  }
}

seed()
