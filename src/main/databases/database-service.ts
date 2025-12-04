import { database } from '@/database'
import { databasesTable, worksheetsTable } from '@/database/schema'
import { PostgresConnectionInfo } from '@/databases/schemas'
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
    connectionInfo: PostgresConnectionInfo,
    type: string
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
          createdAt: updated.createdAt.getTime(),
          databaseId: updated.databaseId ?? null,
          id: updated.id,
          name: updated.name
        }
      }
    }

    return { database: databaseDto, updatedWorksheet }
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
