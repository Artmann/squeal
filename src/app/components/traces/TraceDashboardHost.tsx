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
  const open = useAppSelector((state) => state.ui.traceDashboardOpen ?? false)

  useHotkeys('mod+shift+t', () => {
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
