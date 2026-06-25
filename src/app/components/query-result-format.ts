export function formatCellValue(value: unknown): string {
  if (value === null) {
    return 'null'
  }

  if (typeof value === 'object') {
    return JSON.stringify(value)
  }

  return String(value)
}

export function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }

  return value
}

export function formatRowAsCsv(
  row: Record<string, unknown>,
  fieldNames: string[]
): string {
  const header = fieldNames.map(escapeCsvField).join(',')
  const values = fieldNames
    .map((name) => escapeCsvField(formatCellValue(row[name])))
    .join(',')

  return `${header}\n${values}`
}

export function formatRowAsJson(row: Record<string, unknown>): string {
  return JSON.stringify(row, null, 2)
}
