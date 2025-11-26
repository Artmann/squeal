import { database } from '@/database'
import { worksheetsTable } from '@/database/schema'
import { WorksheetDto } from '@/glue/worksheets'
import { eq } from 'drizzle-orm'

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
      .where(eq(worksheetsTable.deletedAt, null))

    return worksheets.map(transformWorksheet)
  }
}

function transformWorksheet(worksheet: any): WorksheetDto {
  return {
    createdAt: worksheet.createdAt.getTime(),
    id: worksheet.id,
    name: worksheet.name
  }
}
