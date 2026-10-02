// @vitest-environment node
import Database from 'libsql'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SqliteAdapter } from './sqlite-adapter'

// `sqlite-adapter.test.ts` mocks the driver, which cannot show what
// `PRAGMA foreign_key_list` really answers. These tests run against a real
// file, because the bug they cover is in that answer: a foreign key written as
// `REFERENCES parent`, with no column list, reports its `to` column as NULL.

let directory = ''
let databasePath = ''

function createDatabase(statements: string[]): void {
  const database = new Database(databasePath)

  try {
    for (const statement of statements) {
      database.exec(statement)
    }
  } finally {
    database.close()
  }
}

async function getForeignKeys(tableName: string): Promise<unknown> {
  const schema = await new SqliteAdapter({ path: databasePath }).getSchema()

  return schema.tables.find((table) => table.tableName === tableName)
    ?.foreignKeys
}

describe('SqliteAdapter foreign keys', () => {
  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'squeal-sqlite-'))
    databasePath = path.join(directory, 'database.sqlite')
  })

  afterEach(() => {
    rmSync(directory, { force: true, recursive: true })
  })

  it('reports the referenced column of an explicit foreign key', async () => {
    createDatabase([
      'CREATE TABLE parent (id INTEGER PRIMARY KEY)',
      'CREATE TABLE child (parent_id INTEGER REFERENCES parent (id))'
    ])

    expect(await getForeignKeys('child')).toEqual([
      {
        columnName: 'parent_id',
        constraintName: 'fk_child_0',
        referencedColumnName: 'id',
        referencedTableName: 'parent',
        referencedTableSchema: 'main'
      }
    ])
  })

  it('resolves a foreign key without a column list to the parent primary key', async () => {
    createDatabase([
      'CREATE TABLE parent (id INTEGER PRIMARY KEY)',
      'CREATE TABLE child (parent_id INTEGER REFERENCES parent)'
    ])

    expect(await getForeignKeys('child')).toEqual([
      {
        columnName: 'parent_id',
        constraintName: 'fk_child_0',
        referencedColumnName: 'id',
        referencedTableName: 'parent',
        referencedTableSchema: 'main'
      }
    ])
  })

  // The primary key is declared in the opposite order to the columns, so a
  // pairing by column position rather than by key position would cross them.
  it('pairs a composite foreign key with the parent primary key in key order', async () => {
    createDatabase([
      'CREATE TABLE parent (region TEXT, code TEXT, PRIMARY KEY (code, region))',
      'CREATE TABLE child (parent_code TEXT, parent_region TEXT, FOREIGN KEY (parent_code, parent_region) REFERENCES parent)'
    ])

    expect(await getForeignKeys('child')).toEqual([
      {
        columnName: 'parent_code',
        constraintName: 'fk_child_0',
        referencedColumnName: 'code',
        referencedTableName: 'parent',
        referencedTableSchema: 'main'
      },
      {
        columnName: 'parent_region',
        constraintName: 'fk_child_0',
        referencedColumnName: 'region',
        referencedTableName: 'parent',
        referencedTableSchema: 'main'
      }
    ])
  })

  // SQLite accepts these and only fails them when a row is written, so they
  // exist in real files. There is no column to point at, so the key is left
  // out rather than reported with an empty one.
  it('drops a foreign key without a column list when the parent has no primary key', async () => {
    createDatabase([
      'CREATE TABLE parent (id INTEGER)',
      'CREATE TABLE child (parent_id INTEGER REFERENCES parent, owner_id INTEGER REFERENCES owner (id))',
      'CREATE TABLE owner (id INTEGER PRIMARY KEY)'
    ])

    expect(await getForeignKeys('child')).toEqual([
      {
        columnName: 'owner_id',
        constraintName: 'fk_child_0',
        referencedColumnName: 'id',
        referencedTableName: 'owner',
        referencedTableSchema: 'main'
      }
    ])
  })

  it('drops a foreign key without a column list when the parent table does not exist', async () => {
    createDatabase([
      'CREATE TABLE child (parent_id INTEGER REFERENCES missing)'
    ])

    expect(await getForeignKeys('child')).toEqual([])
  })

  it('drops a foreign key whose column count does not match the parent primary key', async () => {
    createDatabase([
      'CREATE TABLE parent (a INTEGER, b INTEGER, PRIMARY KEY (a, b))',
      'CREATE TABLE child (parent_a INTEGER REFERENCES parent)'
    ])

    expect(await getForeignKeys('child')).toEqual([])
  })
})
