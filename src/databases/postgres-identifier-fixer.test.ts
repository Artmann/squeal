import { describe, expect, it } from 'vitest'

import type { SchemaInfo } from './adapter'
import {
  extractMissingRelation,
  rewriteWithQuotedIdentifiers
} from './postgres-identifier-fixer'

describe('extractMissingRelation', () => {
  it('extracts the relation name from a standard error', () => {
    expect(
      extractMissingRelation('relation "insuranceplans" does not exist')
    ).toEqual('insuranceplans')
  })

  it('extracts names with underscores and numbers', () => {
    expect(
      extractMissingRelation('relation "user_accounts_v2" does not exist')
    ).toEqual('user_accounts_v2')
  })

  it('returns null for non-matching errors', () => {
    expect(extractMissingRelation('syntax error at position 5')).toEqual(null)
  })

  it('returns null for column errors', () => {
    expect(extractMissingRelation('column "firstname" does not exist')).toEqual(
      null
    )
  })
})

const schema: SchemaInfo = {
  databaseName: 'test',
  tables: [
    {
      columns: [],
      foreignKeys: [],
      tableName: 'InsurancePlans',
      tableSchema: 'public'
    },
    {
      columns: [],
      foreignKeys: [],
      tableName: 'UserAccounts',
      tableSchema: 'public'
    }
  ]
}

describe('rewriteWithQuotedIdentifiers', () => {
  it('rewrites a simple select with schema qualification', () => {
    expect(
      rewriteWithQuotedIdentifiers(
        'SELECT * FROM InsurancePlans',
        schema,
        'insuranceplans'
      )
    ).toEqual('SELECT * FROM "public"."InsurancePlans"')
  })

  it('rewrites multiple references to the same table', () => {
    const sql =
      'SELECT a.id FROM InsurancePlans a JOIN InsurancePlans b ON a.id = b.id'

    expect(rewriteWithQuotedIdentifiers(sql, schema, 'insuranceplans')).toEqual(
      'SELECT a.id FROM "public"."InsurancePlans" a JOIN "public"."InsurancePlans" b ON a.id = b.id'
    )
  })

  it('leaves already-quoted identifiers unchanged', () => {
    expect(
      rewriteWithQuotedIdentifiers(
        'SELECT * FROM "InsurancePlans"',
        schema,
        'insuranceplans'
      )
    ).toEqual(null)
  })

  it('returns null when the table is not in the schema', () => {
    expect(
      rewriteWithQuotedIdentifiers(
        'SELECT * FROM MissingTable',
        schema,
        'missingtable'
      )
    ).toEqual(null)
  })

  it('preserves the rest of the query', () => {
    const sql = 'SELECT id, name FROM InsurancePlans WHERE id = 1 ORDER BY name'

    expect(rewriteWithQuotedIdentifiers(sql, schema, 'insuranceplans')).toEqual(
      'SELECT id, name FROM "public"."InsurancePlans" WHERE id = 1 ORDER BY name'
    )
  })

  it('handles lowercase input matching a mixed-case table', () => {
    expect(
      rewriteWithQuotedIdentifiers(
        'SELECT * FROM insuranceplans',
        schema,
        'insuranceplans'
      )
    ).toEqual('SELECT * FROM "public"."InsurancePlans"')
  })

  it('schema-qualifies tables not in the public schema', () => {
    const nonPublicSchema: SchemaInfo = {
      databaseName: 'test',
      tables: [
        {
          columns: [],
          foreignKeys: [],
          tableName: 'InsurancePlans',
          tableSchema: 'billing'
        }
      ]
    }

    expect(
      rewriteWithQuotedIdentifiers(
        'SELECT * FROM InsurancePlans',
        nonPublicSchema,
        'insuranceplans'
      )
    ).toEqual('SELECT * FROM "billing"."InsurancePlans"')
  })

  it('does not double-qualify when schema is already specified', () => {
    const nonPublicSchema: SchemaInfo = {
      databaseName: 'test',
      tables: [
        {
          columns: [],
          foreignKeys: [],
          tableName: 'InsurancePlans',
          tableSchema: 'billing'
        }
      ]
    }

    expect(
      rewriteWithQuotedIdentifiers(
        'SELECT * FROM billing.InsurancePlans',
        nonPublicSchema,
        'insuranceplans'
      )
    ).toEqual('SELECT * FROM billing."InsurancePlans"')
  })
})
