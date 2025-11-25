import { memo, ReactElement } from 'react'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from './ui/table'

export const QueryResultTable = memo(function QueryResultTable({
  result
}: {
  result: any
}): ReactElement {
  console.log({ result })

  const fieldNames = result.fields.map((field: any) => field.name)

  return (
    <div className="w-full h-full border border-border overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead></TableHead>
            {fieldNames.map((name: string) => (
              <TableHead key={name}>{name}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.rows.map((row: any, rowIndex: number) => (
            <TableRow key={String(rowIndex)}>
              {fieldNames.map((name: string) => (
                <TableCell key={`${rowIndex}-${name}`}>
                  {String(row[name])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
})
