import type { WorksheetDto } from '@/glue/worksheets'

/**
 * Names a new worksheet "Untitled", then "Untitled 2", "Untitled 3" and so on.
 *
 * Takes one past the highest suffix already in use rather than counting the
 * untitled worksheets. Counting collides as soon as the set has a gap: rename
 * "Untitled" to something else while "Untitled 2" exists and the count is 1
 * again, so the next worksheet is named "Untitled 2" on top of the one already
 * there. Deleting one does the same.
 */
export function getNextUntitledName(worksheets: WorksheetDto[]): string {
  const suffixes = worksheets.flatMap((worksheet) => {
    if (worksheet.name === 'Untitled') {
      return [1]
    }

    const numbered = /^Untitled (\d+)$/.exec(worksheet.name)

    return numbered ? [Number(numbered[1])] : []
  })

  if (suffixes.length === 0) {
    return 'Untitled'
  }

  return `Untitled ${Math.max(...suffixes) + 1}`
}
