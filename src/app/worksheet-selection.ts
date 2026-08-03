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

// The database a new worksheet should start on, so creating one keeps the
// connection you were just using instead of dropping you back on "no database".
// Falls back to the most recently opened worksheet that has one, which covers
// creating from the sidebar with no tab active.
export function pickDatabaseForNewWorksheet(
  worksheets: WorksheetDto[],
  activeWorksheetId: string | undefined
): string | undefined {
  const activeWorksheet = worksheets.find(
    (worksheet) => worksheet.id === activeWorksheetId
  )

  if (activeWorksheet?.databaseId) {
    return activeWorksheet.databaseId
  }

  let pick: string | undefined
  let latestOpenedAt = 0

  for (const worksheet of worksheets) {
    if (
      worksheet.databaseId &&
      worksheet.lastOpenedAt &&
      worksheet.lastOpenedAt > latestOpenedAt
    ) {
      latestOpenedAt = worksheet.lastOpenedAt
      pick = worksheet.databaseId
    }
  }

  return pick
}
