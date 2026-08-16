import { lazy, ReactElement, Suspense } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

import { useAppDispatch, useAppSelector } from '@/app/store'
import { uiActions } from '@/app/store/ui-slice'

const SettingsScreen = lazy(() =>
  import('./SettingsScreen').then((module) => ({
    default: module.SettingsScreen
  }))
)

export function SettingsHost(): ReactElement | null {
  const dispatch = useAppDispatch()
  const open = useAppSelector((state) => state.ui.settingsOpen ?? false)

  useHotkeys('mod+comma', () => {
    dispatch(uiActions.toggleSettings())
  })

  if (!open) {
    return null
  }

  return (
    <Suspense fallback={null}>
      <SettingsScreen />
    </Suspense>
  )
}
