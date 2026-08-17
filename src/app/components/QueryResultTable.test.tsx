import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, it, expect, vi } from 'vitest'

import { stubElementSize } from '../test-element-size'
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
  // The row list is virtualized, so it needs a viewport with a real height.
  stubElementSize()
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

  it('numbers rows from one in the gutter cell', () => {
    render(<QueryResultTable result={result} />)

    const [, firstRow, secondRow] = screen.getAllByRole('row')

    expect(within(firstRow).getAllByRole('cell')[0]).toHaveTextContent('1')
    expect(within(secondRow).getAllByRole('cell')[0]).toHaveTextContent('2')
  })

  it('renders NULL for null values', () => {
    render(
      <QueryResultTable
        result={{
          fields: [{ name: 'name' }],
          rowCount: 1,
          rows: [{ name: null }],
          truncated: false
        }}
      />
    )

    expect(screen.getByText('null')).toBeInTheDocument()
  })

  it('windows a large result instead of rendering every row', () => {
    const largeResult = {
      fields: [{ name: 'id' }],
      rows: Array.from({ length: 10000 }, (_, index) => ({ id: index })),
      rowCount: 10000,
      truncated: true
    }

    render(<QueryResultTable result={largeResult} />)

    // A 600px viewport of 34px rows plus overscan is nowhere near 10,000 —
    // that is the whole point of virtualizing the 10,000-row cap.
    const renderedRows = screen.getAllByRole('row')

    expect(renderedRows.length).toBeLessThan(100)
    expect(renderedRows.length).toBeGreaterThan(1)
  })

  it('falls back to the row keys when the adapter returned no field metadata', () => {
    render(
      <QueryResultTable
        result={{
          fields: [],
          rowCount: 1,
          rows: [{ title: 'Alien' }],
          truncated: false
        }}
      />
    )

    expect(
      screen.getByRole('columnheader', { name: 'title' })
    ).toBeInTheDocument()
    expect(screen.getByText('Alien')).toBeInTheDocument()
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

  describe('alignment', () => {
    const numericResult = {
      fields: [{ name: 'name' }, { name: 'total' }],
      rowCount: 2,
      rows: [
        { name: 'Alice', total: 1000 },
        { name: 'Bob', total: 25 }
      ],
      truncated: false
    }

    // Asserted as "has one and not the other", because an element carrying both
    // `text-left` and `text-right` would satisfy a presence-only check while
    // rendering whichever the stylesheet happened to order last.
    it('right-aligns a numeric column header over its values', () => {
      render(<QueryResultTable result={numericResult} />)

      const header = screen.getByRole('columnheader', { name: 'total' })

      expect({
        left: header.classList.contains('text-left'),
        right: header.classList.contains('text-right')
      }).toEqual({ left: false, right: true })
    })

    it('leaves a text column header left-aligned', () => {
      render(<QueryResultTable result={numericResult} />)

      const header = screen.getByRole('columnheader', { name: 'name' })

      expect({
        left: header.classList.contains('text-left'),
        right: header.classList.contains('text-right')
      }).toEqual({ left: true, right: false })
    })

    // A null used to be aligned on its own type, so it hung off the left edge
    // of a column of right-aligned numbers.
    it('aligns a null in a numeric column with the rest of the column', () => {
      render(
        <QueryResultTable
          result={{
            fields: [{ name: 'total' }],
            rowCount: 2,
            rows: [{ total: 1000 }, { total: null }],
            truncated: false
          }}
        />
      )

      const [, , nullRow] = screen.getAllByRole('row')

      expect(within(nullRow).getAllByRole('cell')[1]).toHaveClass('text-right')
    })
  })

  // Two fields can carry one name — `SELECT * FROM a JOIN b` where both have an
  // `id`. Keying the columns by name collapsed them and gave siblings a
  // duplicate React key, in a virtualized body that remounts constantly.
  describe('duplicate column names', () => {
    const duplicateResult = {
      fields: [{ name: 'id' }, { name: 'name' }, { name: 'id' }],
      rowCount: 1,
      rows: [{ id: 1, name: 'Alice' }],
      truncated: false
    }

    it('renders one header per field', () => {
      render(<QueryResultTable result={duplicateResult} />)

      expect(screen.getAllByRole('columnheader')).toHaveLength(4)
    })

    // Asserting the count, not the values: the driver's row is keyed by name, so
    // both `id` columns still show the first one's value. That is a known limit
    // of fixing the key model without an array row mode in the adapter.
    it('renders one cell per field', () => {
      render(<QueryResultTable result={duplicateResult} />)

      const [, firstRow] = screen.getAllByRole('row')

      // Three fields plus the row-number gutter.
      expect(within(firstRow).getAllByRole('cell')).toHaveLength(4)
    })

    it('does not warn about duplicate keys', () => {
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined)

      try {
        render(<QueryResultTable result={duplicateResult} />)

        expect(
          consoleError.mock.calls.filter((call) =>
            String(call[0]).includes('same key')
          )
        ).toEqual([])
      } finally {
        // In a finally so a failure here does not leave console.error stubbed
        // for every test after it, silently swallowing their warnings.
        consoleError.mockRestore()
      }
    })
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
