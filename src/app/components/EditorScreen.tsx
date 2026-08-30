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

// The two shapes the screen has: an add, which has no database, and an edit,
// which always names one. Structurally the store's `EditorScreen`, so App can
// spread the state straight in.
export type EditorScreenProps =
  | { type: 'create-database' }
  | { databaseId: string; type: 'edit-database' }

export function EditorScreen(props: EditorScreenProps): ReactElement {
  const dispatch = useAppDispatch()
  const databases = useDatabases()

  const databaseId =
    props.type === 'edit-database' ? props.databaseId : undefined

  const database = useMemo(
    () =>
      databaseId ? databases.data.find((d) => d.id === databaseId) : undefined,
    [databases.data, databaseId]
  )

  const handleClose = useCallback(() => {
    dispatch(uiActions.closeEditorScreen())
  }, [dispatch])

  const isCreateMode = props.type === 'create-database'
  const title = isCreateMode ? 'Add database' : 'Edit database'

  const isNotFound = props.type === 'edit-database' && database === undefined

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

  // Absolute rather than fixed, so it covers the screen slot App gives it and
  // not the title bar above it — the frameless window has no other close button
  // and no other drag region.
  //
  // Centered by an auto margin on the card rather than by `items-center`,
  // because centering something taller than its scroller splits the overflow
  // across both edges, and `scrollTop` cannot go negative — the top of the form
  // is then unreachable on a short window.
  //
  // `max-h-full` caps the card at the slot minus the `py-6` above, and the
  // form scrolls its own fields inside that. So the overlay's own
  // `overflow-y-auto` is now a backstop rather than the mechanism — the card
  // does not outgrow it, which is what keeps the title and the Save button on
  // screen at every window height.
  return (
    <div className="absolute inset-0 z-(--z-overlay) bg-bg/70 flex justify-center items-start overflow-y-auto py-6">
      <div className="w-full max-w-lg max-h-full my-auto flex flex-col gap-6 overflow-hidden rounded-md border border-border bg-panel p-6 shadow-[0_8px_24px_rgba(0,0,0,0.14)]">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">{title}</h1>

          <Button
            aria-label="Close"
            size="icon-sm"
            variant="ghost"
            onClick={handleClose}
          >
            <XIcon className="size-4" />
          </Button>
        </div>

        {isNotFound ? (
          // Deletion is the only writer that removes a row, and it is not
          // optimistic -- `useDeleteDatabase` writes in `onSuccess` -- so
          // there is no rollback window to miss an id in. `useDatabases`
          // suspends and App reads it before this can mount, so the list is
          // loaded and this is not a load race either. Rendered inside the
          // panel rather than as a bare message, because the screen covers
          // everything below it and nothing here answers Escape -- a message
          // with no close button is not an error state, it is a stuck window.
          <p className="text-text2">
            This database has been deleted. Close this screen and pick another
            one.
          </p>
        ) : (
          <DatabaseForm
            databaseId={databaseId}
            defaultValues={defaultValues}
            variant="dialog"
            onCancel={handleClose}
            onSuccess={handleClose}
          />
        )}
      </div>
    </div>
  )
}
