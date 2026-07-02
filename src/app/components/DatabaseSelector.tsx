import { DatabaseIcon } from 'lucide-react'
import invariant from 'tiny-invariant'
import { ReactElement, useCallback, useMemo } from 'react'

import { useCollections } from '../collections-context'
import { useDatabases, useWorksheets } from '../hooks/queries'
import { useAppSelector } from '../store'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from './ui/select'

export function DatabaseSelector(): ReactElement {
  const databases = useDatabases()
  const worksheets = useWorksheets()
  const openWorksheetId = useAppSelector(
    (state) => state.editor.openWorksheetId
  )
  const { worksheets: worksheetsCollection } = useCollections()

  const currentWorksheet = useMemo(
    () => worksheets.data.find((worksheet) => worksheet.id === openWorksheetId),
    [worksheets.data, openWorksheetId]
  )

  const handleDatabaseChange = useCallback(
    (databaseId: string) => {
      if (!openWorksheetId) {
        return
      }

      invariant(currentWorksheet, 'No current worksheet found.')

      const transaction = worksheetsCollection.update(
        openWorksheetId,
        (draft) => {
          draft.databaseId = databaseId
        }
      )

      // The optimistic change rolls back automatically if the save fails.
      void transaction.isPersisted.promise.catch((): void => undefined)
    },
    [currentWorksheet, openWorksheetId, worksheetsCollection]
  )

  if (databases.data.length === 0) {
    return (
      <div className="text-subtext-0 text-xs px-3">No databases configured</div>
    )
  }

  return (
    <Select
      value={currentWorksheet?.databaseId ?? undefined}
      onValueChange={handleDatabaseChange}
    >
      <SelectTrigger className="text-xs w-fit">
        <DatabaseIcon className="size-3 text-mauve mr-1" />
        <SelectValue placeholder="Select a database" />
      </SelectTrigger>

      <SelectContent>
        {databases.data.map((database) => (
          <SelectItem
            key={database.id}
            value={database.id}
          >
            {database.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
