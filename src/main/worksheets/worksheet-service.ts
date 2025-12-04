import { database } from '@/database'
import { worksheetsTable } from '@/database/schema'
import { WorksheetDto } from '@/glue/worksheets'
import { eq, isNull } from 'drizzle-orm'

export class WorksheetService {
  async createWorksheet(name: string): Promise<WorksheetDto> {
    const [worksheet] = await database
      .insert(worksheetsTable)
      .values({ name })
      .returning()

    return transformWorksheet(worksheet)
  }

  async listWorksheets(): Promise<WorksheetDto[]> {
    const worksheets = await database
      .select()
      .from(worksheetsTable)
      .where(isNull(worksheetsTable.deletedAt))

    return worksheets.map(transformWorksheet)
  }

  async updateWorksheet(
    id: string,
    updates: { databaseId?: string | null; name?: string }
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
    createdAt: worksheet.createdAt,
    databaseId: worksheet.databaseId ?? null,
    id: worksheet.id,
    name: worksheet.name
  }
}
