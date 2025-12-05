import { DatabaseIcon } from 'lucide-react'
import invariant from 'tiny-invariant'
import { ReactElement, useCallback, useMemo } from 'react'

import { apiClient } from '../api-client'
import { useAppDispatch, useAppSelector } from '../store'
import { worksheetUpdated } from '../store/editor-slice'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from './ui/select'

export function DatabaseSelector(): ReactElement {
  const dispatch = useAppDispatch()
  const databases = useAppSelector((state) => state.editor.databases)
  const worksheets = useAppSelector((state) => state.editor.worksheets)
  const openWorksheetId = useAppSelector(
    (state) => state.editor.openWorksheetId
  )

  const currentWorksheet = useMemo(
    () => worksheets.find((worksheet) => worksheet.id === openWorksheetId),
    [worksheets, openWorksheetId]
  )

  const handleDatabaseChange = useCallback(
    async (databaseId: string) => {
      if (!openWorksheetId) {
        return
      }

      invariant(currentWorksheet, 'No current worksheet found.')

      dispatch(
        worksheetUpdated({
          ...currentWorksheet,
          databaseId
        })
      )

      try {
        const worksheet = await apiClient.updateWorksheet(openWorksheetId, {
          databaseId
        })

        dispatch(worksheetUpdated(worksheet))
      } catch (error) {
        console.error('Error updating worksheet database:', error)
      }
    },
    [dispatch, openWorksheetId]
  )

  if (databases.length === 0) {
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
        {databases.map((database) => (
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
