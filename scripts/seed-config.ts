// Loading this reads `.env`, which is why it is a module of its own rather than
// two consts at the top of `seed.ts`: importing `seed.ts` runs the seed, and the
// seed drops schemas. Keeping the targets separately importable is what lets a
// test check where they point without pointing anything anywhere.
//
// `dotenv/config` is the same spelling `src/database/index.ts` already uses.
// It leaves an already-set variable alone, so a shell export and CI still win
// over a `.env` left in the tree.
import 'dotenv/config'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

// `import.meta.dirname` is undefined here — the repository has no
// `"type": "module"`, so `tsx` loads this as CommonJS and only populates
// `import.meta.url`. This spelling works under `tsx` and under vitest both.
const scriptsDirectory = dirname(fileURLToPath(import.meta.url))

/**
 * The PostgreSQL instance `yarn seed` loads the Pagila sample data into,
 * dropping and recreating its public schema first.
 *
 * The default is the `postgres` service in `docker-compose.yml` — port 5433,
 * not 5432, so it misses a Postgres already running on the host.
 */
export const postgresUrl =
  process.env.POSTGRES_URL ??
  'postgresql://postgres:postgres@localhost:5433/squeal'

/**
 * Where `yarn seed` writes the SQLite sample database, deleting whatever is
 * already there.
 *
 * The default is anchored to the repository rather than the working directory,
 * so it names one file wherever the script is launched from. An override is
 * not: `.env` itself is read from the working directory, and `.env.example`
 * documents a relative path, so `SQLITE_PATH=./seed-sqlite/pagila.sqlite` means
 * whatever `./` meant to the caller. Under `yarn seed` the two are the same
 * directory — yarn runs a script from the package root wherever it was invoked
 * from — so they only part company under a bare `npx tsx scripts/seed.ts`.
 */
export const sqlitePath =
  process.env.SQLITE_PATH ??
  join(scriptsDirectory, '..', 'seed-sqlite', 'pagila.sqlite')
