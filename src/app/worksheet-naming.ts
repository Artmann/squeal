import type { WorksheetDto } from '@/glue/worksheets'

/**
 * Names a new worksheet "Untitled", then "Untitled 2", "Untitled 3" and so on.
 * Counts the existing untitled worksheets rather than tracking a counter, so
 * the name stays stable across restarts.
 */
export function getNextUntitledName(worksheets: WorksheetDto[]): string {
  const untitledCount = worksheets.filter(
    (worksheet) =>
      worksheet.name === 'Untitled' || /^Untitled \d+$/.test(worksheet.name)
  ).length

  return untitledCount === 0 ? 'Untitled' : `Untitled ${untitledCount + 1}`
}
