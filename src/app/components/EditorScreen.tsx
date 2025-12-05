import { XIcon } from 'lucide-react'
import { ReactElement, useCallback, useMemo } from 'react'

import { useAppDispatch, useAppSelector } from '../store'
import { databaseUpdated } from '../store/editor-slice'
import { uiActions } from '../store/ui-slice'
import { DatabaseForm, DatabaseFormResult } from './DatabaseForm'
import { Button } from './ui/button'

export interface EditorScreenProps {
  databaseId: string
}

export function EditorScreen({ databaseId }: EditorScreenProps): ReactElement {
  const dispatch = useAppDispatch()
  const databases = useAppSelector((state) => state.editor.databases)

  const database = useMemo(
    () => databases.find((d) => d.id === databaseId),
    [databases, databaseId]
  )

  const handleClose = useCallback(() => {
    dispatch(uiActions.closeEditorScreen())
  }, [dispatch])

  const handleSuccess = useCallback(
    (result: DatabaseFormResult) => {
      dispatch(databaseUpdated(result.database))
      dispatch(uiActions.closeEditorScreen())
    },
    [dispatch]
  )

  if (!database) {
    return (
      <div className="fixed inset-0 z-100 bg-mantle flex justify-center items-center">
        <div className="text-subtext-0">Database not found.</div>
      </div>
    )
  }

  const defaultValues = {
    connectionInfo: {
      database: database.connectionInfo.database,
      host: database.connectionInfo.host,
      password: database.connectionInfo.password,
      port: String(database.connectionInfo.port),
      username: database.connectionInfo.username
    },
    name: database.name
  }

  return (
    <div className="fixed inset-0 z-100 bg-mantle flex justify-center items-center">
      <div className="w-full max-w-md flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Edit database</h1>

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
          onSuccess={handleSuccess}
        />
      </div>
    </div>
  )
}
