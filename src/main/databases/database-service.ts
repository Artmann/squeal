import { database } from '@/database'
import { databasesTable, worksheetsTable } from '@/database/schema'
import type { ConnectionInfo, DatabaseType } from '@/databases/schemas'
import { DatabaseDto } from '@/glue/databases'
import { WorksheetDto } from '@/glue/worksheets'
import { and, eq, isNull } from 'drizzle-orm'

export interface CreateDatabaseResult {
  database: DatabaseDto
  updatedWorksheet?: WorksheetDto
}

export class DatabaseService {
  async createDatabase(
    name: string,
    connectionInfo: ConnectionInfo,
    type: DatabaseType
  ): Promise<CreateDatabaseResult> {
    const [record] = await database
      .insert(databasesTable)
      .values({
        connectionInfo: JSON.stringify(connectionInfo),
        name,
        type
      })
      .returning()

    const databaseDto = transformDatabase(record)

    // If this is the first database and there's a worksheet without a database, connect it.
    const existingDatabases = await database
      .select()
      .from(databasesTable)
      .where(isNull(databasesTable.deletedAt))

    let updatedWorksheet: WorksheetDto | undefined

    if (existingDatabases.length === 1) {
      const worksheetsWithoutDatabase = await database
        .select()
        .from(worksheetsTable)
        .where(
          and(
            isNull(worksheetsTable.deletedAt),
            isNull(worksheetsTable.databaseId)
          )
        )

      if (worksheetsWithoutDatabase.length === 1) {
        const [updated] = await database
          .update(worksheetsTable)
          .set({ databaseId: databaseDto.id })
          .where(eq(worksheetsTable.id, worksheetsWithoutDatabase[0].id))
          .returning()

        updatedWorksheet = {
          content: updated.content,
          createdAt: updated.createdAt,
          databaseId: updated.databaseId ?? null,
          id: updated.id,
          lastOpenedAt: updated.lastOpenedAt ?? null,
          name: updated.name
        }
      }
    }

    return { database: databaseDto, updatedWorksheet }
  }

  async getDatabase(id: string): Promise<DatabaseDto | null> {
    const [record] = await database
      .select()
      .from(databasesTable)
      .where(and(eq(databasesTable.id, id), isNull(databasesTable.deletedAt)))
      .limit(1)

    if (!record) {
      return null
    }

    return transformDatabase(record)
  }

  async listDatabases(): Promise<DatabaseDto[]> {
    const records = await database
      .select()
      .from(databasesTable)
      .where(isNull(databasesTable.deletedAt))

    return records.map(transformDatabase)
  }

  async updateDatabase(
    id: string,
    name: string,
    connectionInfo: ConnectionInfo,
    type: DatabaseType
  ): Promise<DatabaseDto> {
    const [record] = await database
      .update(databasesTable)
      .set({
        connectionInfo: JSON.stringify(connectionInfo),
        name,
        type
      })
      .where(eq(databasesTable.id, id))
      .returning()

    return transformDatabase(record)
  }
}

function transformDatabase(
  record: typeof databasesTable.$inferSelect
): DatabaseDto {
  return {
    connectionInfo: JSON.parse(record.connectionInfo),
    createdAt: record.createdAt,
    id: record.id,
    name: record.name,
    type: record.type as DatabaseType
  }
}
