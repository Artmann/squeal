import { PanelLeftCloseIcon, PanelLeftOpenIcon } from 'lucide-react'
import { ReactElement } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

import { getSidebarShortcut } from '../sidebar-shortcut'
import { useAppDispatch, useAppSelector } from '../store'
import { uiActions } from '../store/ui-slice'

// Shared with `AppSidebar`, which puts it on the element this button controls.
export const sidebarElementId = 'app-sidebar'

// The toggle's own id, so the sidebar can hand focus back to it when it hides
// while holding focus.
export const sidebarToggleId = 'sidebar-toggle'

/**
 * Registers the Toggle sidebar hotkey. Registered with
 * `enableOnContentEditable` because CodeMirror is a contenteditable and holds
 * focus most of the time, which is exactly when the editor width matters.
 */
export function useSidebarHotkey(): void {
  const dispatch = useAppDispatch()

  useHotkeys(
    'mod+b',
    () => {
      dispatch(uiActions.toggleSidebar())
    },
    {
      enableOnContentEditable: true,
      enableOnFormTags: true,
      preventDefault: true
    },
    [dispatch]
  )
}

export function SidebarToggle(): ReactElement {
  const dispatch = useAppDispatch()
  const collapsed = useAppSelector(
    (state) => state.ui.sidebarCollapsed ?? false
  )

  const label = collapsed ? 'Show sidebar' : 'Hide sidebar'

  return (
    <button
      aria-controls={sidebarElementId}
      aria-expanded={!collapsed}
      aria-label={label}
      className="size-7 flex items-center justify-center rounded-sm text-text2 hover:bg-hover transition-colors"
      id={sidebarToggleId}
      onClick={() => dispatch(uiActions.toggleSidebar())}
      title={`${label} (${getSidebarShortcut()})`}
      type="button"
    >
      {collapsed ? (
        <PanelLeftOpenIcon className="size-[15px]" />
      ) : (
        <PanelLeftCloseIcon className="size-[15px]" />
      )}
    </button>
  )
}
