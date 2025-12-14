import { describe, expect, it } from 'vitest'

import type { ColumnRow, ForeignKeyRow } from './schema-provider'
import { transformToSchemaInfo } from './schema-provider'

describe('transformToSchemaInfo', () => {
  it('groups columns by table', () => {
    const columnRows: ColumnRow[] = [
      {
        column_default: null,
        column_name: 'id',
        data_type: 'integer',
        is_nullable: 'NO',
        is_primary_key: true,
        ordinal_position: 1,
        table_name: 'users',
        table_schema: 'public'
      },
      {
        column_default: null,
        column_name: 'name',
        data_type: 'varchar',
        is_nullable: 'YES',
        is_primary_key: false,
        ordinal_position: 2,
        table_name: 'users',
        table_schema: 'public'
      },
      {
        column_default: null,
        column_name: 'id',
        data_type: 'integer',
        is_nullable: 'NO',
        is_primary_key: true,
        ordinal_position: 1,
        table_name: 'posts',
        table_schema: 'public'
      }
    ]

    const result = transformToSchemaInfo('testdb', columnRows, [])

    expect(result.tables).toHaveLength(2)
    expect(result.tables[0].tableName).toEqual('posts')
    expect(result.tables[0].columns).toHaveLength(1)
    expect(result.tables[1].tableName).toEqual('users')
    expect(result.tables[1].columns).toHaveLength(2)
  })

  it('attaches foreign keys to tables', () => {
    const columnRows: ColumnRow[] = [
      {
        column_default: null,
        column_name: 'id',
        data_type: 'integer',
        is_nullable: 'NO',
        is_primary_key: true,
        ordinal_position: 1,
        table_name: 'posts',
        table_schema: 'public'
      },
      {
        column_default: null,
        column_name: 'user_id',
        data_type: 'integer',
        is_nullable: 'NO',
        is_primary_key: false,
        ordinal_position: 2,
        table_name: 'posts',
        table_schema: 'public'
      }
    ]

    const foreignKeyRows: ForeignKeyRow[] = [
      {
        column_name: 'user_id',
        constraint_name: 'posts_user_id_fkey',
        referenced_column_name: 'id',
        referenced_table_name: 'users',
        referenced_table_schema: 'public',
        table_name: 'posts',
        table_schema: 'public'
      }
    ]

    const result = transformToSchemaInfo('testdb', columnRows, foreignKeyRows)

    expect(result.tables[0].foreignKeys).toEqual([
      {
        columnName: 'user_id',
        constraintName: 'posts_user_id_fkey',
        referencedColumnName: 'id',
        referencedTableName: 'users',
        referencedTableSchema: 'public'
      }
    ])
  })

  it('handles empty result sets', () => {
    const result = transformToSchemaInfo('testdb', [], [])

    expect(result).toEqual({
      databaseName: 'testdb',
      tables: []
    })
  })

  it('transforms column properties correctly', () => {
    const columnRows: ColumnRow[] = [
      {
        column_default: 'now()',
        column_name: 'created_at',
        data_type: 'timestamp',
        is_nullable: 'NO',
        is_primary_key: false,
        ordinal_position: 3,
        table_name: 'users',
        table_schema: 'public'
      }
    ]

    const result = transformToSchemaInfo('testdb', columnRows, [])

    expect(result.tables[0].columns[0]).toEqual({
      columnName: 'created_at',
      dataType: 'timestamp',
      defaultValue: 'now()',
      isNullable: false,
      isPrimaryKey: false,
      ordinalPosition: 3
    })
  })

  it('handles MySQL boolean format for is_primary_key', () => {
    const columnRows: ColumnRow[] = [
      {
        column_default: null,
        column_name: 'id',
        data_type: 'int',
        is_nullable: 'NO',
        is_primary_key: 1,
        ordinal_position: 1,
        table_name: 'users',
        table_schema: 'testdb'
      }
    ]

    const result = transformToSchemaInfo('testdb', columnRows, [])

    expect(result.tables[0].columns[0].isPrimaryKey).toEqual(true)
  })

  it('sorts tables by schema and name', () => {
    const columnRows: ColumnRow[] = [
      {
        column_default: null,
        column_name: 'id',
        data_type: 'integer',
        is_nullable: 'NO',
        is_primary_key: true,
        ordinal_position: 1,
        table_name: 'zebra',
        table_schema: 'public'
      },
      {
        column_default: null,
        column_name: 'id',
        data_type: 'integer',
        is_nullable: 'NO',
        is_primary_key: true,
        ordinal_position: 1,
        table_name: 'apple',
        table_schema: 'public'
      },
      {
        column_default: null,
        column_name: 'id',
        data_type: 'integer',
        is_nullable: 'NO',
        is_primary_key: true,
        ordinal_position: 1,
        table_name: 'banana',
        table_schema: 'admin'
      }
    ]

    const result = transformToSchemaInfo('testdb', columnRows, [])

    expect(result.tables.map((t) => `${t.tableSchema}.${t.tableName}`)).toEqual([
      'admin.banana',
      'public.apple',
      'public.zebra'
    ])
  })

  it('ignores foreign keys for tables not in columns', () => {
    const columnRows: ColumnRow[] = [
      {
        column_default: null,
        column_name: 'id',
        data_type: 'integer',
        is_nullable: 'NO',
        is_primary_key: true,
        ordinal_position: 1,
        table_name: 'users',
        table_schema: 'public'
      }
    ]

    const foreignKeyRows: ForeignKeyRow[] = [
      {
        column_name: 'user_id',
        constraint_name: 'nonexistent_fkey',
        referenced_column_name: 'id',
        referenced_table_name: 'users',
        referenced_table_schema: 'public',
        table_name: 'nonexistent',
        table_schema: 'public'
      }
    ]

    const result = transformToSchemaInfo('testdb', columnRows, foreignKeyRows)

    expect(result.tables[0].foreignKeys).toEqual([])
  })
})
