// @vitest-environment node
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type ForeignKeyRow, postgresForeignKeysQuery } from './schema-provider'

// Runs against a real server, because the bug this covers lives in the SQL and
// a mocked driver hands back whatever rows it is told to. Skipped unless a
// connection string is given, since CI has no Postgres:
//
//   SQUEAL_TEST_POSTGRES_URL=postgres://postgres:postgres@localhost:5432/postgres yarn test schema-provider.postgres
//
// Everything happens inside one transaction that is rolled back, so the server
// is left as it was found.
const connectionString = process.env.SQUEAL_TEST_POSTGRES_URL

describe.skipIf(connectionString === undefined)(
  'postgresForeignKeysQuery against a real server',
  () => {
    const client = new Client({ connectionString })

    beforeAll(async () => {
      await client.connect()
      await client.query('BEGIN')

      // Two schemas with a constraint of the same name in each, both composite,
      // and the second listing its columns in a different order than the key
      // it points at.
      await client.query(`
        CREATE SCHEMA squeal_test_alpha;
        CREATE SCHEMA squeal_test_beta;

        CREATE TABLE squeal_test_alpha.parent (x int, y int, PRIMARY KEY (x, y));
        CREATE TABLE squeal_test_alpha.child (
          p int,
          q int,
          CONSTRAINT child_fk FOREIGN KEY (p, q)
            REFERENCES squeal_test_alpha.parent (x, y)
        );

        CREATE TABLE squeal_test_beta.owner (m int, n int, UNIQUE (m, n));
        CREATE TABLE squeal_test_beta.child (
          r int,
          s int,
          CONSTRAINT child_fk FOREIGN KEY (s, r)
            REFERENCES squeal_test_beta.owner (n, m)
        );
      `)
    })

    afterAll(async () => {
      try {
        await client.query('ROLLBACK')
      } finally {
        await client.end()
      }
    })

    it('pairs each column with the column it references, once', async () => {
      const result = await client.query<ForeignKeyRow>(postgresForeignKeysQuery)

      const rows = result.rows.filter((row) =>
        row.table_schema.startsWith('squeal_test_')
      )

      expect(rows).toEqual([
        {
          column_name: 'p',
          constraint_name: 'child_fk',
          referenced_column_name: 'x',
          referenced_table_name: 'parent',
          referenced_table_schema: 'squeal_test_alpha',
          table_name: 'child',
          table_schema: 'squeal_test_alpha'
        },
        {
          column_name: 'q',
          constraint_name: 'child_fk',
          referenced_column_name: 'y',
          referenced_table_name: 'parent',
          referenced_table_schema: 'squeal_test_alpha',
          table_name: 'child',
          table_schema: 'squeal_test_alpha'
        },
        {
          column_name: 's',
          constraint_name: 'child_fk',
          referenced_column_name: 'n',
          referenced_table_name: 'owner',
          referenced_table_schema: 'squeal_test_beta',
          table_name: 'child',
          table_schema: 'squeal_test_beta'
        },
        {
          column_name: 'r',
          constraint_name: 'child_fk',
          referenced_column_name: 'm',
          referenced_table_name: 'owner',
          referenced_table_schema: 'squeal_test_beta',
          table_name: 'child',
          table_schema: 'squeal_test_beta'
        }
      ])
    })
  }
)
