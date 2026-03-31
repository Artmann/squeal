import { ReactElement, useCallback } from 'react'

import { useAppDispatch } from '../store'
import { databaseAdded, worksheetUpdated } from '../store/editor-slice'
import { uiActions } from '../store/ui-slice'
import { DatabaseForm, DatabaseFormResult } from './DatabaseForm'

export function GettingStartedScreen(): ReactElement {
  const dispatch = useAppDispatch()

  const handleSuccess = useCallback(
    (result: DatabaseFormResult) => {
      dispatch(databaseAdded(result.database))

      if (result.updatedWorksheet) {
        dispatch(worksheetUpdated(result.updatedWorksheet))
      }

      dispatch(uiActions.gettingStartedCompleted())
    },
    [dispatch]
  )

  return (
    <div className="fixed inset-0 z-100 bg-mantle flex justify-center items-center">
      <div className="w-full max-w-md flex flex-col gap-6">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-mauve mb-3">
            Squeal
          </div>

          <h1 className="text-3xl font-semibold mb-2">Connect a database</h1>

          <p className="text-subtext-0">
            Add your first database connection to get started.
          </p>
        </div>

        <DatabaseForm onSuccess={handleSuccess} />
      </div>
    </div>
  )
}
