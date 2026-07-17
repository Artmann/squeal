import { database } from '@/database'
import { worksheetsTable } from '@/database/schema'
import { ApiError } from '@/errors'
import { CreateWorksheetRequest, WorksheetDto } from '@/glue/worksheets'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'

export class WorksheetService {
  async createWorksheet(
    request: CreateWorksheetRequest
  ): Promise<WorksheetDto> {
    const [worksheet] = await database
      .insert(worksheetsTable)
      .values(request)
      .returning()

    return transformWorksheet(worksheet)
  }

  async listWorksheets(): Promise<WorksheetDto[]> {
    // Unordered worksheets keep the newest-first behavior after the ordered
    // ones.
    const worksheets = await database
      .select()
      .from(worksheetsTable)
      .where(isNull(worksheetsTable.deletedAt))
      .orderBy(
        sql`${worksheetsTable.sortOrder} is null`,
        asc(worksheetsTable.sortOrder),
        desc(worksheetsTable.createdAt)
      )

    return worksheets.map(transformWorksheet)
  }

  // Only writes sortOrder so a reorder can never clobber content edits that
  // are in flight.
  async reorderWorksheets(worksheetIds: string[]): Promise<WorksheetDto[]> {
    const records = await database
      .select({ id: worksheetsTable.id })
      .from(worksheetsTable)
      .where(
        and(
          inArray(worksheetsTable.id, worksheetIds),
          isNull(worksheetsTable.deletedAt)
        )
      )

    if (records.length !== worksheetIds.length) {
      throw new ApiError(400, 'One or more worksheet ids are unknown.')
    }

    for (const [index, id] of worksheetIds.entries()) {
      await database
        .update(worksheetsTable)
        .set({ sortOrder: index })
        .where(eq(worksheetsTable.id, id))
    }

    return this.listWorksheets()
  }

  async updateWorksheet(
    id: string,
    updates: {
      content?: string
      databaseId?: string | null
      lastOpenedAt?: number
      name?: string
    }
  ): Promise<WorksheetDto> {
    const [worksheet] = await database
      .update(worksheetsTable)
      .set(updates)
      .where(eq(worksheetsTable.id, id))
      .returning()

    return transformWorksheet(worksheet)
  }
}

function transformWorksheet(
  worksheet: typeof worksheetsTable.$inferSelect
): WorksheetDto {
  return {
    content: worksheet.content,
    createdAt: worksheet.createdAt,
    databaseId: worksheet.databaseId ?? null,
    id: worksheet.id,
    lastOpenedAt: worksheet.lastOpenedAt ?? null,
    name: worksheet.name,
    sortOrder: worksheet.sortOrder ?? null
  }
}
