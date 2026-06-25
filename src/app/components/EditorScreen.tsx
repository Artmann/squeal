import { XIcon } from 'lucide-react'
import { ReactElement, useCallback, useMemo } from 'react'

import { useDatabases } from '../hooks/queries'
import { useAppDispatch } from '../store'
import { uiActions } from '../store/ui-slice'
import { DatabaseForm } from './DatabaseForm'
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
  const databases = useDatabases()

  const database = useMemo(
    () =>
      databaseId ? databases.data.find((d) => d.id === databaseId) : undefined,
    [databases.data, databaseId]
  )

  const handleClose = useCallback(() => {
    dispatch(uiActions.closeEditorScreen())
  }, [dispatch])

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
          onSuccess={handleClose}
        />
      </div>
    </div>
  )
}
