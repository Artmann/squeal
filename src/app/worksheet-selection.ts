import type { WorksheetDto } from '@/glue/worksheets'

// Picks the worksheet to open on startup or after the open one is deleted:
// keep the current one when it still exists, otherwise the most recently
// opened, otherwise the first. Returns undefined when no change is needed.
export function pickWorksheetToOpen(
  worksheets: WorksheetDto[],
  openWorksheetId: string | undefined
): string | undefined {
  if (openWorksheetId) {
    const stillExists = worksheets.some(
      (worksheet) => worksheet.id === openWorksheetId
    )

    if (stillExists) {
      return undefined
    }
  }

  let pick: string | undefined
  let latestOpenedAt = 0

  for (const worksheet of worksheets) {
    if (worksheet.lastOpenedAt && worksheet.lastOpenedAt > latestOpenedAt) {
      latestOpenedAt = worksheet.lastOpenedAt
      pick = worksheet.id
    }
  }

  return pick ?? worksheets[0]?.id
}
