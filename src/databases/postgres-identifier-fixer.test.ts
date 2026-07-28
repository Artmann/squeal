import { describe, expect, it } from 'vitest'

import type { ColumnInfo, SchemaInfo } from './adapter'
import {
  extractMissingColumn,
  extractMissingRelation,
  rewriteWithQuotedColumns,
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

describe('extractMissingColumn', () => {
  it('extracts the column name from a standard error', () => {
    expect(extractMissingColumn('column "platformid" does not exist')).toEqual(
      'platformid'
    )
  })

  it('extracts the column from a column-of-relation error', () => {
    expect(
      extractMissingColumn(
        'column "firstname" of relation "employees" does not exist'
      )
    ).toEqual('firstname')
  })

  it('returns null for non-matching errors', () => {
    expect(extractMissingColumn('syntax error at position 5')).toEqual(null)
  })

  it('returns null for relation errors', () => {
    expect(extractMissingColumn('relation "employees" does not exist')).toEqual(
      null
    )
  })
})

function makeColumn(columnName: string): ColumnInfo {
  return {
    columnName,
    dataType: 'text',
    defaultValue: null,
    isNullable: true,
    isPrimaryKey: false,
    ordinalPosition: 1
  }
}

const columnSchema: SchemaInfo = {
  databaseName: 'test',
  tables: [
    {
      columns: [
        makeColumn('Id'),
        makeColumn('PlatformId'),
        makeColumn('FirstName')
      ],
      foreignKeys: [],
      tableName: 'Employees',
      tableSchema: 'platform'
    }
  ]
}

describe('rewriteWithQuotedColumns', () => {
  it('quotes a mis-cased column with its real casing', () => {
    expect(
      rewriteWithQuotedColumns(
        "SELECT * FROM Employees WHERE PlatformId = 'x'",
        columnSchema,
        'platformid'
      )
    ).toEqual('SELECT * FROM Employees WHERE "PlatformId" = \'x\'')
  })

  it('quotes every occurrence of the column', () => {
    expect(
      rewriteWithQuotedColumns(
        "SELECT PlatformId FROM Employees WHERE PlatformId = 'x'",
        columnSchema,
        'platformid'
      )
    ).toEqual('SELECT "PlatformId" FROM Employees WHERE "PlatformId" = \'x\'')
  })

  it('only rewrites the missing column, leaving other columns untouched', () => {
    expect(
      rewriteWithQuotedColumns(
        "SELECT Id, PlatformId FROM Employees WHERE PlatformId = 'x'",
        columnSchema,
        'platformid'
      )
    ).toEqual(
      'SELECT Id, "PlatformId" FROM Employees WHERE "PlatformId" = \'x\''
    )
  })

  it('rewrites a lowercase reference to its mixed-case column', () => {
    expect(
      rewriteWithQuotedColumns(
        'SELECT platformid FROM Employees',
        columnSchema,
        'platformid'
      )
    ).toEqual('SELECT "PlatformId" FROM Employees')
  })

  it('leaves already-quoted columns unchanged', () => {
    expect(
      rewriteWithQuotedColumns(
        'SELECT "PlatformId" FROM Employees',
        columnSchema,
        'platformid'
      )
    ).toEqual(null)
  })

  it('returns null when the column is not in the schema', () => {
    expect(
      rewriteWithQuotedColumns(
        'SELECT Missing FROM Employees',
        columnSchema,
        'missing'
      )
    ).toEqual(null)
  })

  it('returns null when the casing is ambiguous across tables', () => {
    const ambiguousSchema: SchemaInfo = {
      databaseName: 'test',
      tables: [
        {
          columns: [makeColumn('Status')],
          foreignKeys: [],
          tableName: 'Employees',
          tableSchema: 'platform'
        },
        {
          columns: [makeColumn('status')],
          foreignKeys: [],
          tableName: 'Orders',
          tableSchema: 'platform'
        }
      ]
    }

    expect(
      rewriteWithQuotedColumns(
        'SELECT Status FROM Employees',
        ambiguousSchema,
        'status'
      )
    ).toEqual(null)
  })
})
