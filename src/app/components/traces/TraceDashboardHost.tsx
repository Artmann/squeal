import { lazy, ReactElement, Suspense } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

import { useAppDispatch, useAppSelector } from '@/app/store'
import { uiActions } from '@/app/store/ui-slice'

const TraceDashboard = lazy(() =>
  import('./TraceDashboard').then((module) => ({
    default: module.TraceDashboard
  }))
)

export function TraceDashboardHost(): ReactElement | null {
  const dispatch = useAppDispatch()
  const isEditorScreenOpen = useAppSelector(
    (state) => state.ui.editorScreen !== undefined
  )
  const open = useAppSelector((state) => state.ui.traceDashboardOpen ?? false)

  useHotkeys('mod+shift+t', () => {
    // The editor screen is a modal dialog: it traps focus and turns pointer
    // events off everywhere else, so a dashboard opened over it could be seen
    // but not clicked or typed into. Close the form first.
    if (isEditorScreenOpen && !open) {
      return
    }

    dispatch(uiActions.toggleTraceDashboard())
  })

  if (!open) {
    return null
  }

  return (
    <Suspense fallback={null}>
      <TraceDashboard />
    </Suspense>
  )
}
