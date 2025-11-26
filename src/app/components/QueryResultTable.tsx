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
      <TableHeader className="sticky top-0 bg-background border-t border-border">
        <TableRow className="bg-background">
          <TableHead className="border-r border-border"></TableHead>
          {fieldNames.map((name: string) => (
            <TableHead
              className="border-r border-border font-normal last:border-r-0"
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
            <TableCell className="border-r border-border px-0.5 text-center text-muted-foreground">
              {rowIndex + 1}
            </TableCell>
            {fieldNames.map((name: string) => {
              const value = row[name]
              const isNumber = typeof value === 'number'

              return (
                <TableCell
                  className={cn(
                    'border-r border-border last:border-r-0',
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
