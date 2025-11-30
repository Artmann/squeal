import { database } from '@/database'
import { databasesTable } from '@/database/schema'
import { PostgresConnectionInfo } from '@/databases/schemas'
import { DatabaseDto } from '@/glue/databases'
import { isNull } from 'drizzle-orm'

export class DatabaseService {
  async createDatabase(
    name: string,
    connectionInfo: PostgresConnectionInfo,
    type: string
  ): Promise<DatabaseDto> {
    const [record] = await database
      .insert(databasesTable)
      .values({
        connectionInfo: JSON.stringify(connectionInfo),
        name,
        type
      })
      .returning()

    return transformDatabase(record)
  }

  async listDatabases(): Promise<DatabaseDto[]> {
    const records = await database
      .select()
      .from(databasesTable)
      .where(isNull(databasesTable.deletedAt))

    return records.map(transformDatabase)
  }
}

function transformDatabase(
  record: typeof databasesTable.$inferSelect
): DatabaseDto {
  return {
    connectionInfo: JSON.parse(record.connectionInfo),
    createdAt: record.createdAt.getTime(),
    id: record.id,
    name: record.name,
    type: record.type
  }
}
