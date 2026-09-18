import { MySQL, PostgreSQL, SQLite } from '@codemirror/lang-sql'
import { describe, expect, it } from 'vitest'

import {
  buildSqlNamespace,
  findDefaultSchemaName,
  listColumnCompletions,
  listSchemaNames,
  quoteIdentifier
} from './sql-namespace'
import type { ColumnInfo, TableInfo } from '@/databases/adapter'
import type { SchemaInfoDto } from '@/glue/api/schemas'

function column(
  columnName: string,
  ordinalPosition: number,
  overrides: Partial<ColumnInfo> = {}
): ColumnInfo {
  return {
    columnName,
    dataType: 'text',
    defaultValue: null,
    isNullable: true,
    isPrimaryKey: false,
    ordinalPosition,
    ...overrides
  }
}

function table(
  tableName: string,
  columns: ColumnInfo[],
  tableSchema = 'public'
): TableInfo {
  return { columns, foreignKeys: [], tableName, tableSchema }
}

function schemaOf(tables: TableInfo[], databaseName = 'pagila'): SchemaInfoDto {
  return { databaseName, tables }
}

const users = table('users', [
  column('id', 1, {
    dataType: 'integer',
    isNullable: false,
    isPrimaryKey: true
  }),
  column('email', 2, { isNullable: false }),
  column('nickname', 3)
])

describe('quoteIdentifier', () => {
  it('leaves a plain lower-case name bare', () => {
    expect(quoteIdentifier('created_at', PostgreSQL)).toEqual('created_at')
  })

  it('quotes a name whose case the server would fold away', () => {
    expect(quoteIdentifier('createdAt', PostgreSQL)).toEqual('"createdAt"')
  })

  it('quotes a name the parser would read as syntax', () => {
    expect(quoteIdentifier('order', PostgreSQL)).toEqual('"order"')
  })

  it('quotes a name with a space in it', () => {
    expect(quoteIdentifier('Order Items', PostgreSQL)).toEqual('"Order Items"')
  })

  it('uses the quote character the dialect declares', () => {
    expect({
      mysql: quoteIdentifier('order', MySQL),
      postgres: quoteIdentifier('order', PostgreSQL),
      // SQLite accepts both and declares the backtick first, which is the one
      // lang-sql auto-quotes with — the two have to agree.
      sqlite: quoteIdentifier('order', SQLite)
    }).toEqual({
      mysql: '`order`',
      postgres: '"order"',
      sqlite: '`order`'
    })
  })

  it('doubles a quote character the name already contains', () => {
    expect(quoteIdentifier('we"ird', PostgreSQL)).toEqual('"we""ird"')
  })
})

describe('listColumnCompletions', () => {
  it('keeps the table declaration order and describes each column', () => {
    expect(listColumnCompletions(users, PostgreSQL)).toEqual([
      { boost: 1, detail: 'integer · pk', label: 'id', type: 'property' },
      { boost: 0, detail: 'text · not null', label: 'email', type: 'property' },
      { boost: 0, detail: 'text', label: 'nickname', type: 'property' }
    ])
  })

  it('orders by ordinal position rather than by the order it was handed', () => {
    const scrambled = table('t', [
      column('c', 3),
      column('a', 1),
      column('b', 2)
    ])

    expect(
      listColumnCompletions(scrambled, PostgreSQL).map(
        (completion) => completion.label
      )
    ).toEqual(['a', 'b', 'c'])
  })

  it('inserts the quoted form of a column that needs one', () => {
    const awkward = table('t', [column('Created At', 1)])

    expect(listColumnCompletions(awkward, PostgreSQL)).toEqual([
      {
        apply: '"Created At"',
        boost: 0,
        detail: 'text',
        label: 'Created At',
        type: 'property'
      }
    ])
  })
})

describe('listSchemaNames', () => {
  it('returns each schema once, sorted', () => {
    const schema = schemaOf([
      table('a', [], 'reporting'),
      table('b', [], 'public'),
      table('c', [], 'reporting')
    ])

    expect(listSchemaNames(schema)).toEqual(['public', 'reporting'])
  })

  it('returns nothing for a database with no tables', () => {
    expect(listSchemaNames(schemaOf([]))).toEqual([])
  })
})

describe('findDefaultSchemaName', () => {
  it('uses the only schema there is, whatever it is called', () => {
    const schema = schemaOf([table('a', [], 'inventory')])

    expect(findDefaultSchemaName(schema, 'postgres')).toEqual('inventory')
  })

  it("falls back to the dialect's own default when there are several", () => {
    const schema = schemaOf([
      table('a', [], 'public'),
      table('b', [], 'reporting')
    ])

    expect(findDefaultSchemaName(schema, 'postgres')).toEqual('public')
  })

  it('uses the connected database as the default schema on MySQL', () => {
    const schema = schemaOf(
      [table('a', [], 'pagila'), table('b', [], 'information_schema')],
      'pagila'
    )

    expect(findDefaultSchemaName(schema, 'mysql')).toEqual('pagila')
  })

  // Naming a schema the introspection did not find would make lang-sql resolve
  // every unqualified name into an empty level and offer nothing at all, so
  // "no default" is the safer answer than a guess.
  it('has no default when the dialect default is not among the schemas', () => {
    const schema = schemaOf([
      table('a', [], 'reporting'),
      table('b', [], 'staging')
    ])

    expect(findDefaultSchemaName(schema, 'postgres')).toBeUndefined()
  })

  it('has no default for a database with no tables', () => {
    expect(findDefaultSchemaName(schemaOf([]), 'postgres')).toBeUndefined()
  })
})

describe('buildSqlNamespace', () => {
  it('nests schema, table and columns the way lang-sql completes them', () => {
    expect(buildSqlNamespace(schemaOf([users]), PostgreSQL)).toEqual({
      public: {
        children: {
          users: {
            children: [
              {
                boost: 1,
                detail: 'integer · pk',
                label: 'id',
                type: 'property'
              },
              {
                boost: 0,
                detail: 'text · not null',
                label: 'email',
                type: 'property'
              },
              { boost: 0, detail: 'text', label: 'nickname', type: 'property' }
            ],
            self: { label: 'users', type: 'type' }
          }
        },
        self: { label: 'public', type: 'namespace' }
      }
    })
  })

  it('names the schema on each table once a database has more than one', () => {
    const schema = schemaOf([
      table('events', [], 'reporting'),
      table('events', [], 'public')
    ])

    expect(buildSqlNamespace(schema, PostgreSQL)).toEqual({
      public: {
        children: {
          events: {
            children: [],
            self: { detail: 'public', label: 'events', type: 'type' }
          }
        },
        self: { label: 'public', type: 'namespace' }
      },
      reporting: {
        children: {
          events: {
            children: [],
            self: { detail: 'reporting', label: 'events', type: 'type' }
          }
        },
        self: { label: 'reporting', type: 'namespace' }
      }
    })
  })

  it('carries the quoted form for a table name that needs one', () => {
    const schema = schemaOf([table('Order Items', [])])

    expect(buildSqlNamespace(schema, PostgreSQL)).toEqual({
      public: {
        children: {
          'Order Items': {
            children: [],
            self: {
              apply: '"Order Items"',
              label: 'Order Items',
              type: 'type'
            }
          }
        },
        self: { label: 'public', type: 'namespace' }
      }
    })
  })

  // A view, or a table the connected user may see but not describe. The table
  // still completes; it simply has nothing under it.
  it('keeps a table that introspected no columns', () => {
    const schema = schemaOf([table('legacy_view', [])])

    expect(buildSqlNamespace(schema, PostgreSQL)).toEqual({
      public: {
        children: {
          legacy_view: {
            children: [],
            self: { label: 'legacy_view', type: 'type' }
          }
        },
        self: { label: 'public', type: 'namespace' }
      }
    })
  })

  it('is empty for a database with no tables', () => {
    expect(buildSqlNamespace(schemaOf([]), PostgreSQL)).toEqual({})
  })
})
