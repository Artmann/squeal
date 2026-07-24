import { describe, expect, it } from 'vitest'

import { computeDatabaseMatch } from './database-explorer-search'
import { ColumnInfo, SchemaInfo, TableInfo } from '@/databases/adapter'
import { DatabaseDto } from '@/glue/databases'

function makeColumn(columnName: string, ordinalPosition: number): ColumnInfo {
  return {
    columnName,
    dataType: 'text',
    defaultValue: null,
    isNullable: true,
    isPrimaryKey: false,
    ordinalPosition
  }
}

function makeTable(tableName: string, columnNames: string[]): TableInfo {
  return {
    columns: columnNames.map((columnName, index) =>
      makeColumn(columnName, index + 1)
    ),
    foreignKeys: [],
    tableName,
    tableSchema: 'public'
  }
}

function makeDatabase(name: string): DatabaseDto {
  return {
    connectionInfo: { path: `${name}.db` },
    createdAt: 0,
    id: `db-${name}`,
    name,
    sortOrder: null,
    type: 'sqlite'
  }
}

function makeSchema(tables: TableInfo[]): SchemaInfo {
  return {
    databaseName: 'testdb',
    tables
  }
}

describe('computeDatabaseMatch', () => {
  it('returns null for a blank query', () => {
    const database = makeDatabase('analytics')
    const schema = makeSchema([makeTable('events', ['id'])])

    expect(computeDatabaseMatch(database, schema, '   ')).toEqual(null)
  })

  it('matches on the database name and returns all tables collapsed', () => {
    const database = makeDatabase('analytics')
    const events = makeTable('events', ['id', 'name'])
    const schema = makeSchema([events])

    expect(computeDatabaseMatch(database, schema, 'analy')).toEqual({
      database,
      expandDatabase: false,
      tables: [events]
    })
  })

  it('matches on a table name and returns only matching tables', () => {
    const database = makeDatabase('shop')
    const users = makeTable('users', ['id', 'email'])
    const orders = makeTable('orders', ['id', 'total'])
    const schema = makeSchema([orders, users])

    expect(computeDatabaseMatch(database, schema, 'user')).toEqual({
      database,
      expandDatabase: true,
      tables: [users]
    })
  })

  it('keeps matching tables in schema order', () => {
    const database = makeDatabase('shop')
    const customers = makeTable('customers', ['id'])
    const customerAccounts = makeTable('customerAccounts', ['id'])
    const orders = makeTable('orders', ['id'])
    const schema = makeSchema([customers, customerAccounts, orders])

    expect(computeDatabaseMatch(database, schema, 'customer')).toEqual({
      database,
      expandDatabase: true,
      tables: [customers, customerAccounts]
    })
  })

  it('does not match on column names', () => {
    const database = makeDatabase('shop')
    const orders = makeTable('orders', ['id', 'customer_id', 'total'])
    const schema = makeSchema([orders])

    // 'customer' only appears as a column name, so nothing should match.
    expect(computeDatabaseMatch(database, schema, 'customer')).toEqual(null)
  })

  it('is case insensitive', () => {
    const database = makeDatabase('shop')
    const users = makeTable('Users', ['Id'])
    const schema = makeSchema([users])

    expect(computeDatabaseMatch(database, schema, 'USER')).toEqual({
      database,
      expandDatabase: true,
      tables: [users]
    })
  })

  it('returns null when nothing matches', () => {
    const database = makeDatabase('shop')
    const schema = makeSchema([makeTable('orders', ['id', 'total'])])

    expect(computeDatabaseMatch(database, schema, 'zzz')).toEqual(null)
  })

  it('returns null when the schema has not loaded and the name does not match', () => {
    const database = makeDatabase('shop')

    expect(computeDatabaseMatch(database, undefined, 'orders')).toEqual(null)
  })
})
