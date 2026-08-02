import { XIcon } from 'lucide-react'
import { ReactElement, useCallback, useMemo } from 'react'

import type { PublicConnectionInfo } from '@/glue/api/schemas'

import { useDatabases } from '../hooks/queries'
import { useAppDispatch } from '../store'
import { uiActions } from '../store/ui-slice'
import { DatabaseForm } from './DatabaseForm'
import type { DatabaseFormConnectionInfo } from './DatabaseForm'
import { Button } from './ui/button'

// The DTO and the form's input type are close but not identical: the DTO omits
// the password and treats port as optional, while the form wants every server
// field present and normalizes port itself. Mapping field by field keeps that
// difference visible instead of hiding it behind a cast.
function toFormConnectionInfo(
  connectionInfo: PublicConnectionInfo
): DatabaseFormConnectionInfo {
  if ('path' in connectionInfo) {
    return { path: connectionInfo.path }
  }

  return {
    database: connectionInfo.database,
    host: connectionInfo.host,
    port: connectionInfo.port,
    sslMode: connectionInfo.sslMode,
    sslRootCert: connectionInfo.sslRootCert,
    username: connectionInfo.username
  }
}

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
      <div className="fixed inset-0 z-100 bg-bg/70 flex justify-center items-center">
        <div className="rounded-md border border-border bg-panel px-6 py-5 text-text2 shadow-[0_8px_24px_rgba(0,0,0,0.14)]">
          Database not found.
        </div>
      </div>
    )
  }

  const isCreateMode = mode === 'create'
  const title = isCreateMode ? 'Add database' : 'Edit database'

  const defaultValues = database
    ? {
        // Null when the stored secret could not be decrypted; the form opens
        // with empty connection fields so saving repairs the row.
        connectionInfo:
          database.connectionInfo === null
            ? undefined
            : toFormConnectionInfo(database.connectionInfo),
        name: database.name,
        type: database.type
      }
    : undefined

  return (
    <div className="fixed inset-0 z-100 bg-bg/70 flex justify-center items-center overflow-y-auto py-10">
      <div className="w-full max-w-md flex flex-col gap-6 rounded-md border border-border bg-panel p-6 shadow-[0_8px_24px_rgba(0,0,0,0.14)]">
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
