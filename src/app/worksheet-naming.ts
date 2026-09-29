import type { WorksheetDto } from '@/glue/worksheets'

/**
 * Names a duplicate "Revenue copy", then "Revenue copy 2" and so on, the way
 * Finder does. A copy of a copy is numbered from the same base rather than
 * becoming "Revenue copy copy". Like `getNextUntitledName`, it goes one past
 * the highest suffix in use so a gap never hands out a name that is taken.
 */
export function getDuplicateName(
  worksheets: WorksheetDto[],
  name: string
): string {
  const stripped = name.replace(/ copy(?: \d+)?$/, '')
  const base = stripped.length > 0 ? stripped : name
  const copyName = `${base} copy`

  const suffixes = worksheets.flatMap((worksheet) => {
    if (worksheet.name === copyName) {
      return [1]
    }

    if (!worksheet.name.startsWith(`${copyName} `)) {
      return []
    }

    const suffix = worksheet.name.slice(copyName.length + 1)

    return /^\d+$/.test(suffix) ? [Number(suffix)] : []
  })

  if (suffixes.length === 0) {
    return copyName
  }

  return `${copyName} ${Math.max(...suffixes) + 1}`
}

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
