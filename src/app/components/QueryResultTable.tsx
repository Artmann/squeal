import { memo, ReactElement } from 'react'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from './ui/table'
import { cn } from '../lib/utils'

export const QueryResultTable = memo(function QueryResultTable({
  result
}: {
  result: any
}): ReactElement {
  console.log({ result })

  const fieldNames = result.fields.map((field: any) => field.name)

  return (
    <Table className="w-full text-xs">
      <TableHeader className="sticky top-0 bg-base border-t border-surface-0">
        <TableRow className="bg-base">
          <TableHead className="border-r border-surface-0"></TableHead>
          {fieldNames.map((name: string) => (
            <TableHead
              className="border-r border-surface-0 font-normal last:border-r-0"
              key={name}
            >
              {name}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {result.rows.map((row: any, rowIndex: number) => (
          <TableRow key={String(rowIndex)}>
            <TableCell className="border-r border-surface-0 px-0.5 text-center text-subtext-0">
              {rowIndex + 1}
            </TableCell>
            {fieldNames.map((name: string) => {
              const value = row[name]
              const isNumber = typeof value === 'number'

              return (
                <TableCell
                  className={cn(
                    'border-r border-surface-0 last:border-r-0',
                    isNumber ? 'text-right' : 'text-left'
                  )}
                  key={`${rowIndex}-${name}`}
                >
                  {String(value)}
                </TableCell>
              )
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
})
