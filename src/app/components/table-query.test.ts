import { describe, expect, it } from 'vitest'

import type { TableInfo } from '@/databases/adapter'

import { buildTableQuery } from './table-query'

function createTable(tableName: string, tableSchema = 'public'): TableInfo {
  return {
    columns: [],
    foreignKeys: [],
    tableName,
    tableSchema
  }
}

describe('buildTableQuery', () => {
  it('quotes the table name', () => {
    expect(buildTableQuery(createTable('users'), 'postgres', false)).toEqual(
      'SELECT * FROM "users" LIMIT 100'
    )
  })

  it('leaves the schema out when the database only has one', () => {
    expect(
      buildTableQuery(createTable('users', 'billing'), 'postgres', false)
    ).toEqual('SELECT * FROM "users" LIMIT 100')
  })

  it('qualifies the table when the database spans several schemas', () => {
    expect(
      buildTableQuery(createTable('users', 'billing'), 'postgres', true)
    ).toEqual('SELECT * FROM "billing"."users" LIMIT 100')
  })

  it('preserves mixed case, which an unquoted name would lose', () => {
    expect(
      buildTableQuery(createTable('InsurancePlans'), 'postgres', false)
    ).toEqual('SELECT * FROM "InsurancePlans" LIMIT 100')
  })

  it('quotes reserved words', () => {
    expect(buildTableQuery(createTable('order'), 'postgres', false)).toEqual(
      'SELECT * FROM "order" LIMIT 100'
    )
  })

  it('quotes with backticks on MySQL', () => {
    expect(
      buildTableQuery(createTable('users', 'shop'), 'mysql', true)
    ).toEqual('SELECT * FROM `shop`.`users` LIMIT 100')
  })

  it('quotes with double quotes on SQLite', () => {
    expect(
      buildTableQuery(createTable('users', 'main'), 'sqlite', true)
    ).toEqual('SELECT * FROM "main"."users" LIMIT 100')
  })

  it('doubles a quote character inside the name so it cannot end the quote', () => {
    expect(buildTableQuery(createTable('we"ird'), 'postgres', false)).toEqual(
      'SELECT * FROM "we""ird" LIMIT 100'
    )

    expect(buildTableQuery(createTable('we`ird'), 'mysql', false)).toEqual(
      'SELECT * FROM `we``ird` LIMIT 100'
    )
  })
})
