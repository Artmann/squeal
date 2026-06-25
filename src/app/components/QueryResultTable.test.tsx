import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, it, expect, vi } from 'vitest'

import {
  escapeCsvField,
  formatCellValue,
  formatRowAsCsv,
  formatRowAsJson
} from './query-result-format'
import { QueryResultTable } from './QueryResultTable'

const writeText = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  Element.prototype.scrollTo = vi.fn()
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    writable: true,
    configurable: true
  })
  writeText.mockClear()
})

describe('formatCellValue', () => {
  it('returns "null" for null values', () => {
    expect(formatCellValue(null)).toEqual('null')
  })

  it('converts numbers to strings', () => {
    expect(formatCellValue(42)).toEqual('42')
  })

  it('converts booleans to strings', () => {
    expect(formatCellValue(true)).toEqual('true')
  })

  it('returns strings as-is', () => {
    expect(formatCellValue('hello')).toEqual('hello')
  })

  it('serializes objects as JSON', () => {
    expect(formatCellValue({ a: 1 })).toEqual('{"a":1}')
  })

  it('serializes arrays as JSON', () => {
    expect(formatCellValue([1, 2, 3])).toEqual('[1,2,3]')
  })
})

describe('escapeCsvField', () => {
  it('returns simple values unchanged', () => {
    expect(escapeCsvField('hello')).toEqual('hello')
  })

  it('wraps values containing commas in quotes', () => {
    expect(escapeCsvField('hello,world')).toEqual('"hello,world"')
  })

  it('wraps values containing quotes and escapes them', () => {
    expect(escapeCsvField('say "hi"')).toEqual('"say ""hi"""')
  })

  it('wraps values containing newlines in quotes', () => {
    expect(escapeCsvField('line1\nline2')).toEqual('"line1\nline2"')
  })

  it('handles values with both commas and quotes', () => {
    expect(escapeCsvField('"a",b')).toEqual('"""a"",b"')
  })
})

describe('QueryResultTable', () => {
  const result = {
    fields: [{ name: 'id' }, { name: 'name' }],
    rows: [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' }
    ],
    rowCount: 2,
    truncated: false
  }

  it('renders column headers', () => {
    render(<QueryResultTable result={result} />)

    expect(screen.getByText('id')).toBeInTheDocument()
    expect(screen.getByText('name')).toBeInTheDocument()
  })

  it('renders cell values', () => {
    render(<QueryResultTable result={result} />)

    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
  })

  it('shows context menu on right-click', async () => {
    const user = userEvent.setup()
    render(<QueryResultTable result={result} />)

    const cell = screen.getByText('Alice')
    await user.pointer({ keys: '[MouseRight]', target: cell })

    expect(screen.getByText('Copy')).toBeInTheDocument()
    expect(screen.getByText('Copy Column Name')).toBeInTheDocument()
    expect(screen.getByText('Copy Row')).toBeInTheDocument()
  })
})

describe('formatRowAsCsv', () => {
  it('formats a row as CSV with header', () => {
    const row = { id: 1, name: 'Alice' }
    const fieldNames = ['id', 'name']

    expect(formatRowAsCsv(row, fieldNames)).toEqual('id,name\n1,Alice')
  })

  it('escapes values that contain commas', () => {
    const row = { note: 'hello, world' }
    const fieldNames = ['note']

    expect(formatRowAsCsv(row, fieldNames)).toEqual('note\n"hello, world"')
  })

  it('handles null values', () => {
    const row: Record<string, unknown> = { id: 1, name: null }
    const fieldNames = ['id', 'name']

    expect(formatRowAsCsv(row, fieldNames)).toEqual('id,name\n1,null')
  })
})

describe('formatRowAsJson', () => {
  it('formats a row as pretty-printed JSON', () => {
    const row = { id: 1, name: 'Alice' }

    expect(formatRowAsJson(row)).toEqual(JSON.stringify(row, null, 2))
  })
})
