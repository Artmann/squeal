import { XIcon } from 'lucide-react'
import { ReactElement, useCallback, useMemo } from 'react'

import { useAppDispatch, useAppSelector } from '../store'
import {
  databaseAdded,
  databaseUpdated,
  worksheetUpdated
} from '../store/editor-slice'
import { uiActions } from '../store/ui-slice'
import { DatabaseForm, DatabaseFormResult } from './DatabaseForm'
import { Button } from './ui/button'

export interface EditorScreenProps {
  databaseId?: string
  mode: 'create' | 'edit'
}

export function EditorScreen({
  databaseId,
  mode
}: EditorScreenProps): ReactElement {
  const dispatch = useAppDispatch()
  const databases = useAppSelector((state) => state.editor.databases)

  const database = useMemo(
    () => (databaseId ? databases.find((d) => d.id === databaseId) : undefined),
    [databases, databaseId]
  )

  const handleClose = useCallback(() => {
    dispatch(uiActions.closeEditorScreen())
  }, [dispatch])

  const handleCreateSuccess = useCallback(
    (result: DatabaseFormResult) => {
      dispatch(databaseAdded(result.database))

      if (result.updatedWorksheet) {
        dispatch(worksheetUpdated(result.updatedWorksheet))
      }

      dispatch(uiActions.closeEditorScreen())
    },
    [dispatch]
  )

  const handleEditSuccess = useCallback(
    (result: DatabaseFormResult) => {
      dispatch(databaseUpdated(result.database))
      dispatch(uiActions.closeEditorScreen())
    },
    [dispatch]
  )

  if (mode === 'edit' && !database) {
    return (
      <div className="fixed inset-0 z-100 bg-mantle flex justify-center items-center">
        <div className="text-subtext-0">Database not found.</div>
      </div>
    )
  }

  const isCreateMode = mode === 'create'
  const title = isCreateMode ? 'Add database' : 'Edit database'

  const defaultValues = database
    ? {
        connectionInfo: database.connectionInfo,
        name: database.name,
        type: database.type
      }
    : undefined

  return (
    <div className="fixed inset-0 z-100 bg-mantle flex justify-center items-center">
      <div className="w-full max-w-md flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">{title}</h1>

          <Button
            size="icon-sm"
            variant="ghost"
            onClick={handleClose}
          >
            <XIcon className="size-4" />
          </Button>
        </div>

        <DatabaseForm
          databaseId={databaseId}
          defaultValues={defaultValues}
          onCancel={handleClose}
          onSuccess={isCreateMode ? handleCreateSuccess : handleEditSuccess}
        />
      </div>
    </div>
  )
}
