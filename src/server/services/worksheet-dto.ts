import { worksheetsTable } from '@/database/schema'
import type { WorksheetDto } from '@/glue/api/schemas'

export type WorksheetRow = typeof worksheetsTable.$inferSelect

// Shared by WorksheetService and by DatabaseService, which returns the worksheet
// it connected to a newly created database. Two copies of this mapping is how
// one of them ends up missing a field.
export function toWorksheetDto(worksheet: WorksheetRow): WorksheetDto {
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
