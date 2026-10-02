import { createClient } from '@libsql/client'
import Database from 'libsql'
import invariant from 'tiny-invariant'
import { pathToFileURL } from 'url'

import { maxResultRows } from './adapter'
import type {
  ColumnInfo,
  DatabaseAdapter,
  ForeignKeyInfo,
  QueryResult,
  SchemaInfo
} from './adapter'
import type { SqliteConnectionInfo } from './schemas'
import {
  formatSqliteServerVersion,
  requireServerVersion
} from './server-version'

export class SqliteAdapter implements DatabaseAdapter {
  protected readonly connectionInfo: SqliteConnectionInfo

  constructor(connectionInfo: SqliteConnectionInfo) {
    // Requests are validated against the contract's DatabaseConnection, but
    // stored rows are only JSON.parsed, so a row an older build saved with a
    // server-shaped info can still land here. Without this the failure was
    // `pathToFileURL(undefined)` deep in the driver.
    invariant(
      connectionInfo.path,
      'This connection is saved as SQLite but has no database file. Edit the connection and choose a file.'
    )

    this.connectionInfo = connectionInfo
  }

  async getSchema(): Promise<SchemaInfo> {
    const client = createClient({ url: this.getConnectionUrl() })

    try {
      const tablesResult = await client.execute(`
        SELECT name FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `)

      const tables = await Promise.all(
        tablesResult.rows.map(async (row) => {
          const tableName = row.name as string
          const [columns, foreignKeys] = await Promise.all([
            this.getTableColumns(client, tableName),
            this.getTableForeignKeys(client, tableName)
          ])

          return {
            columns,
            foreignKeys,
            tableName,
            tableSchema: 'main'
          }
        })
      )

      return {
        databaseName: this.getDatabaseName(),
        tables
      }
    } finally {
      client.close()
    }
  }

  // There is no server here — the version is the library's, which is what the
  // user cares about when their SQL depends on a recent SQLite feature.
  async getServerVersion(): Promise<string> {
    const client = createClient({ url: this.getConnectionUrl() })

    try {
      const result = await client.execute('select sqlite_version() as version')
      const version = result.rows[0]?.version
      const rawVersion = typeof version === 'string' ? version : ''

      return requireServerVersion(
        formatSqliteServerVersion(rawVersion),
        rawVersion
      )
    } finally {
      client.close()
    }
  }

  async runQuery(query: string): Promise<QueryResult> {
    const database = new Database(this.connectionInfo.path)

    try {
      const statement = database.prepare(query)

      if (!statement.reader) {
        const info = statement.run()

        return {
          fields: [],
          rowCount: info.changes,
          rows: [],
          truncated: false
        }
      }

      const fields = statement
        .columns()
        .map((column) => ({ name: column.name }))
      const rows: Record<string, unknown>[] = []
      let truncated = false

      // iterate() pulls rows from the native layer lazily, so memory stays
      // bounded no matter how large the result set is.
      for (const row of statement.iterate()) {
        if (rows.length === maxResultRows) {
          truncated = true

          break
        }

        rows.push(row as Record<string, unknown>)
      }

      return { fields, rowCount: rows.length, rows, truncated }
    } finally {
      database.close()
    }
  }

  async testConnection(): Promise<void> {
    const client = createClient({ url: this.getConnectionUrl() })

    try {
      await client.execute('SELECT 1')
    } finally {
      client.close()
    }
  }

  private async getTableColumns(
    client: ReturnType<typeof createClient>,
    tableName: string
  ): Promise<ColumnInfo[]> {
    const result = await client.execute(`PRAGMA table_info("${tableName}")`)

    return result.rows.map((row) => ({
      columnName: row.name as string,
      dataType: (row.type as string) || 'TEXT',
      defaultValue: row.dflt_value as string | null,
      isNullable: row.notnull === 0,
      isPrimaryKey: row.pk === 1,
      ordinalPosition: (row.cid as number) + 1
    }))
  }

  // The parent's primary key columns, in key order rather than column order.
  // `pk` in `PRAGMA table_info` is the column's 1-based position in the key,
  // and 0 for a column outside it. A table that does not exist answers no
  // rows, so it reads as one without a primary key.
  private async getPrimaryKeyColumns(
    client: ReturnType<typeof createClient>,
    tableName: string
  ): Promise<string[]> {
    const result = await client.execute(`PRAGMA table_info("${tableName}")`)

    return result.rows
      .flatMap((row) => {
        const position = Number(row.pk)

        return typeof row.name === 'string' && position > 0
          ? [{ name: row.name, position }]
          : []
      })
      .sort((left, right) => left.position - right.position)
      .map((column) => column.name)
  }

  private async getTableForeignKeys(
    client: ReturnType<typeof createClient>,
    tableName: string
  ): Promise<ForeignKeyInfo[]> {
    const result = await client.execute(
      `PRAGMA foreign_key_list("${tableName}")`
    )

    const foreignKeys = await Promise.all(
      [...groupForeignKeyRows(result.rows)].map(([id, columns]) =>
        this.resolveForeignKey(client, `fk_${tableName}_${id}`, columns)
      )
    )

    return foreignKeys.flat()
  }

  // `REFERENCES parent` with no column list means the parent's primary key,
  // and SQLite reports each `to` as NULL. Passing that NULL on failed the
  // contract's encoding and lost the whole schema. A parent without a primary
  // key of the same width cannot be resolved — SQLite only rejects such a key
  // when a row is written — so it is left out.
  private async resolveForeignKey(
    client: ReturnType<typeof createClient>,
    constraintName: string,
    columns: ForeignKeyColumnRow[]
  ): Promise<ForeignKeyInfo[]> {
    const referencedTableName = columns[0]?.table

    if (typeof referencedTableName !== 'string') {
      return []
    }

    const needsPrimaryKey = columns.some(
      (column) => typeof column.to !== 'string'
    )
    const primaryKeyColumns = needsPrimaryKey
      ? await this.getPrimaryKeyColumns(client, referencedTableName)
      : []

    if (needsPrimaryKey && primaryKeyColumns.length !== columns.length) {
      return []
    }

    return pairForeignKeyColumns(columns, primaryKeyColumns, {
      constraintName,
      referencedTableName
    })
  }

  private getConnectionUrl(): string {
    return pathToFileURL(this.connectionInfo.path).toString()
  }

  private getDatabaseName(): string {
    const parts = this.connectionInfo.path.split(/[/\\]/)

    return parts[parts.length - 1] ?? 'sqlite'
  }
}

interface ForeignKeyColumnRow {
  from: unknown
  seq: number
  table: unknown
  to: unknown
}

// `PRAGMA foreign_key_list` answers one row per column. The columns of one
// key share an `id` and are ordered within it by `seq`.
function groupForeignKeyRows(
  rows: Record<string, unknown>[]
): Map<number, ForeignKeyColumnRow[]> {
  const constraints = new Map<number, ForeignKeyColumnRow[]>()

  for (const row of rows) {
    const id = Number(row.id)
    const columns = constraints.get(id) ?? []

    columns.push({
      from: row.from,
      seq: Number(row.seq),
      table: row.table,
      to: row.to
    })
    constraints.set(id, columns)
  }

  for (const columns of constraints.values()) {
    columns.sort((left, right) => left.seq - right.seq)
  }

  return constraints
}

// Pairs each column with the one it references: its own `to`, or the parent's
// primary key column at the same position. Any column that cannot be paired
// drops the whole key, since half a key would suggest a wrong join.
function pairForeignKeyColumns(
  columns: ForeignKeyColumnRow[],
  primaryKeyColumns: string[],
  reference: { constraintName: string; referencedTableName: string }
): ForeignKeyInfo[] {
  const pairs = columns.map((column, index) => ({
    columnName: column.from,
    referencedColumnName:
      typeof column.to === 'string' ? column.to : primaryKeyColumns[index]
  }))

  const isComplete = pairs.every(
    (pair) =>
      typeof pair.columnName === 'string' &&
      pair.referencedColumnName !== undefined
  )

  if (!isComplete) {
    return []
  }

  return pairs.map((pair) => ({
    columnName: String(pair.columnName),
    constraintName: reference.constraintName,
    referencedColumnName: String(pair.referencedColumnName),
    referencedTableName: reference.referencedTableName,
    referencedTableSchema: 'main'
  }))
}
