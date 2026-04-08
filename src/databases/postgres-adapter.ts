import fs from 'fs'

import { Client, type ClientConfig } from 'pg'

import type { DatabaseAdapter, QueryResult, SchemaInfo } from './adapter'
import {
  extractMissingRelation,
  rewriteWithQuotedIdentifiers
} from './postgres-identifier-fixer'
import {
  postgresColumnsQuery,
  postgresForeignKeysQuery,
  transformToSchemaInfo
} from './schema-provider'
import type { PostgresConnectionInfo } from './schemas'

export class PostgresAdapter implements DatabaseAdapter {
  protected readonly connectionInfo: PostgresConnectionInfo

  constructor(connectionInfo: PostgresConnectionInfo) {
    this.connectionInfo = connectionInfo
  }

  async getSchema(): Promise<SchemaInfo> {
    const client = new Client(createClientConfig(this.connectionInfo))

    try {
      await client.connect()

      return await this.getSchemaWithClient(client)
    } finally {
      await client.end()
    }
  }

  async runQuery(query: string): Promise<QueryResult> {
    const client = new Client(createClientConfig(this.connectionInfo))

    try {
      await client.connect()

      console.log('Connected to database')

      try {
        return await this.executeQuery(client, query)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const missingRelation = extractMissingRelation(message)

        if (!missingRelation) {
          throw error
        }

        const schema = await this.getSchemaWithClient(client)
        const rewritten = rewriteWithQuotedIdentifiers(query, schema, missingRelation)

        if (!rewritten) {
          throw error
        }

        console.log(`  ↻ Retrying with quoted identifiers:\n${rewritten}\n`)

        return await this.executeQuery(client, rewritten)
      }
    } finally {
      await client.end()
    }
  }

  private async executeQuery(client: Client, query: string): Promise<QueryResult> {
    console.log(`Running query:\n${query}\n`)

    const result = await client.query(query)

    console.log(`  ✓ Query executed successfully\n`)

    const maxRows = 10_000
    const allRows = result.rows as Record<string, unknown>[]
    const truncated = allRows.length > maxRows

    return {
      fields: result.fields.map((f) => ({ name: f.name })),
      rowCount: result.rowCount ?? 0,
      rows: truncated ? allRows.slice(0, maxRows) : allRows,
      truncated
    }
  }

  private async getSchemaWithClient(client: Client): Promise<SchemaInfo> {
    const columnsResult = await client.query(postgresColumnsQuery)
    const foreignKeysResult = await client.query(postgresForeignKeysQuery)

    return transformToSchemaInfo(
      this.connectionInfo.database,
      columnsResult.rows,
      foreignKeysResult.rows
    )
  }

  async testConnection(): Promise<void> {
    const client = new Client({
      ...createClientConfig(this.connectionInfo),
      statement_timeout: 5000
    })

    try {
      await client.connect()

      console.log('Connected to database successfully')
    } finally {
      await client.end()
    }
  }
}

function createClientConfig(info: PostgresConnectionInfo): ClientConfig {
  const {
    username,
    password,
    host,
    port = 5432,
    database,
    sslMode,
    sslRootCert
  } = info

  const connectionString = `postgresql://${username}:${password}@${host}:${port}/${database}`

  if (!sslMode || sslMode === 'disable') {
    return { connectionString }
  }

  if (sslMode === 'require') {
    return { connectionString, ssl: { rejectUnauthorized: false } }
  }

  // verify-full
  if (sslRootCert && sslRootCert !== 'system') {
    return {
      connectionString,
      ssl: {
        ca: fs.readFileSync(sslRootCert).toString(),
        rejectUnauthorized: true
      }
    }
  }

  return { connectionString, ssl: { rejectUnauthorized: true } }
}
