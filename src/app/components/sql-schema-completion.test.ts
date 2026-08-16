import { MySQL, PostgreSQL, SQLite } from '@codemirror/lang-sql'
import { describe, expect, it } from 'vitest'

import type { SchemaInfoDto } from '@/glue/api/schemas'
import { toEditorDialect, toSqlNamespace } from './sql-schema-completion'

function makeColumn(
  columnName: string,
  dataType: string,
  isPrimaryKey = false
) {
  return {
    columnName,
    dataType,
    defaultValue: null,
    isNullable: false,
    isPrimaryKey,
    ordinalPosition: 1
  }
}

const pagila: SchemaInfoDto = {
  databaseName: 'pagila',
  tables: [
    {
      columns: [
        makeColumn('film_id', 'integer', true),
        makeColumn('title', 'text')
      ],
      foreignKeys: [],
      tableName: 'film',
      tableSchema: 'public'
    },
    {
      columns: [makeColumn('actor_id', 'integer', true)],
      foreignKeys: [],
      tableName: 'actor',
      tableSchema: 'public'
    }
  ]
}

describe('toSqlNamespace', () => {
  it('offers columns under the qualified and the bare table name', () => {
    expect(toSqlNamespace(pagila)).toEqual({
      actor: [{ detail: 'integer PK', label: 'actor_id', type: 'property' }],
      film: [
        { detail: 'integer PK', label: 'film_id', type: 'property' },
        { detail: 'text', label: 'title', type: 'property' }
      ],
      public: {
        actor: [{ detail: 'integer PK', label: 'actor_id', type: 'property' }],
        film: [
          { detail: 'integer PK', label: 'film_id', type: 'property' },
          { detail: 'text', label: 'title', type: 'property' }
        ]
      }
    })
  })

  it('keeps a table out of the schema level when it has no schema', () => {
    const sqlite: SchemaInfoDto = {
      databaseName: 'app.db',
      tables: [
        {
          columns: [makeColumn('id', 'INTEGER', true)],
          foreignKeys: [],
          tableName: 'worksheets',
          tableSchema: ''
        }
      ]
    }

    expect(toSqlNamespace(sqlite)).toEqual({
      worksheets: [{ detail: 'INTEGER PK', label: 'id', type: 'property' }]
    })
  })

  it('gives the unqualified name to the first table that claims it', () => {
    const duplicated: SchemaInfoDto = {
      databaseName: 'pagila',
      tables: [
        {
          columns: [makeColumn('film_id', 'integer', true)],
          foreignKeys: [],
          tableName: 'film',
          tableSchema: 'public'
        },
        {
          columns: [makeColumn('archived_at', 'timestamp')],
          foreignKeys: [],
          tableName: 'film',
          tableSchema: 'archive'
        }
      ]
    }

    expect(toSqlNamespace(duplicated)).toEqual({
      archive: {
        film: [{ detail: 'timestamp', label: 'archived_at', type: 'property' }]
      },
      film: [{ detail: 'integer PK', label: 'film_id', type: 'property' }],
      public: {
        film: [{ detail: 'integer PK', label: 'film_id', type: 'property' }]
      }
    })
  })

  it('answers with nothing for a database with no tables', () => {
    expect(toSqlNamespace({ databaseName: 'empty', tables: [] })).toEqual({})
  })
})

describe('toEditorDialect', () => {
  it('matches the dialect to the database', () => {
    expect(toEditorDialect('mysql')).toEqual(MySQL)
    expect(toEditorDialect('postgres')).toEqual(PostgreSQL)
    expect(toEditorDialect('sqlite')).toEqual(SQLite)
  })

  it('falls back to PostgreSQL for a worksheet with no database', () => {
    expect(toEditorDialect(undefined)).toEqual(PostgreSQL)
  })
})
