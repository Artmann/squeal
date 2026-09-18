import { MySQL, PostgreSQL } from '@codemirror/lang-sql'
import { describe, expect, it } from 'vitest'

import { findJoinContext, listJoinCompletions } from './sql-join-completions'
import type { ForeignKeyInfo, TableInfo } from '@/databases/adapter'
import type { SchemaInfoDto } from '@/glue/api/schemas'

function foreignKey(
  columnName: string,
  referencedTableName: string,
  referencedColumnName: string,
  constraintName: string
): ForeignKeyInfo {
  return {
    columnName,
    constraintName,
    referencedColumnName,
    referencedTableName,
    referencedTableSchema: 'public'
  }
}

function table(tableName: string, foreignKeys: ForeignKeyInfo[]): TableInfo {
  return { columns: [], foreignKeys, tableName, tableSchema: 'public' }
}

// `orders` points at `users` twice: once for whoever placed it, once for
// whoever it ships to. Two constraints, two different joins.
const schema: SchemaInfoDto = {
  databaseName: 'pagila',
  tables: [
    table('users', []),
    table('orders', [
      foreignKey('user_id', 'users', 'id', 'orders_user_id_fkey'),
      foreignKey('recipient_id', 'users', 'id', 'orders_recipient_id_fkey')
    ]),
    table('order_items', [
      foreignKey('order_id', 'orders', 'id', 'order_items_order_id_fkey')
    ])
  ]
}

function contextAt(documentWithCursor: string) {
  const offset = documentWithCursor.indexOf('|')

  return findJoinContext(documentWithCursor.replace('|', ''), offset)
}

function labelsAt(documentWithCursor: string, dialect = PostgreSQL): string[] {
  const context = contextAt(documentWithCursor)

  if (!context) {
    return []
  }

  return listJoinCompletions(context, schema, dialect).map(
    (completion) => completion.label
  )
}

describe('findJoinContext', () => {
  it('reads the joined table and the tables already in scope', () => {
    expect(contextAt('select * from users u join orders o |')).toEqual({
      joined: { alias: 'o', name: 'orders', schema: undefined },
      sources: [{ alias: 'u', name: 'users', schema: undefined }]
    })
  })

  it('reads an unaliased join', () => {
    expect(contextAt('select * from users join orders |')).toEqual({
      joined: { alias: undefined, name: 'orders', schema: undefined },
      sources: [{ alias: undefined, name: 'users', schema: undefined }]
    })
  })

  it('reads a schema-qualified name and an explicit AS', () => {
    expect(
      contextAt('select * from public.users as u join public.orders as o |')
    ).toEqual({
      joined: { alias: 'o', name: 'orders', schema: 'public' },
      sources: [{ alias: 'u', name: 'users', schema: 'public' }]
    })
  })

  it('carries every table a comma join put in scope', () => {
    expect(
      contextAt('select * from users u, orders o join order_items i |')
    ).toEqual({
      joined: { alias: 'i', name: 'order_items', schema: undefined },
      sources: [
        { alias: 'u', name: 'users', schema: undefined },
        { alias: 'o', name: 'orders', schema: undefined }
      ]
    })
  })

  it('carries an earlier join into scope for the next one', () => {
    expect(
      contextAt(
        'select * from users u join orders o on o.user_id = u.id join order_items i |'
      )
    ).toEqual({
      joined: { alias: 'i', name: 'order_items', schema: undefined },
      sources: [
        { alias: 'u', name: 'users', schema: undefined },
        { alias: 'o', name: 'orders', schema: undefined }
      ]
    })
  })

  it('has no context once the join already has its predicate', () => {
    expect(
      contextAt('select * from users u join orders o on |')
    ).toBeUndefined()
  })

  it('has no context before the joined table is named', () => {
    expect(contextAt('select * from users u join |')).toBeUndefined()
  })

  it('has no context when nothing precedes the join', () => {
    expect(contextAt('select * from users u |')).toBeUndefined()
  })

  it('has no context when the join names a subquery', () => {
    expect(
      contextAt('select * from users u join (select 1) t |')
    ).toBeUndefined()
  })

  it('has no context for a join in the statement before the cursor', () => {
    expect(
      contextAt('select * from users u join orders o;\nselect |')
    ).toBeUndefined()
  })
})

describe('listJoinCompletions', () => {
  it('offers one predicate per foreign key between the two tables', () => {
    expect(labelsAt('select * from users u join orders o |')).toEqual([
      'ON o.user_id = u.id',
      'ON o.recipient_id = u.id'
    ])
  })

  it('reads the relationship from the table already in scope too', () => {
    expect(labelsAt('select * from orders o join order_items i |')).toEqual([
      'ON i.order_id = o.id'
    ])
  })

  it('follows a relationship pointing the other way', () => {
    expect(labelsAt('select * from order_items i join orders o |')).toEqual([
      'ON o.id = i.order_id'
    ])
  })

  it('uses the table name when the clause gave it no alias', () => {
    expect(labelsAt('select * from users join orders |')).toEqual([
      'ON orders.user_id = users.id',
      'ON orders.recipient_id = users.id'
    ])
  })

  it('quotes with the dialect the connection uses', () => {
    const backticked: SchemaInfoDto = {
      databaseName: 'shop',
      tables: [
        table('user', []),
        table('orders', [foreignKey('user_id', 'user', 'id', 'fk_user')])
      ]
    }

    const context = findJoinContext('select * from user u join orders o ', 35)

    expect(
      context && listJoinCompletions(context, backticked, MySQL)[0]
    ).toEqual({
      boost: 2,
      detail: 'fk_user',
      label: 'ON o.user_id = u.id',
      type: 'keyword'
    })
  })

  it('offers nothing when the two tables are unrelated', () => {
    expect(labelsAt('select * from users u join order_items i |')).toEqual([])
  })

  it('offers nothing for a table the schema does not have', () => {
    expect(labelsAt('select * from users u join missing m |')).toEqual([])
  })
})
