import { ReactElement, useEffect, useRef } from 'react'

import { usePersistedSize } from '../hooks/use-persisted-size'
import { useAppSelector } from '../store'
import { DatabaseExplorer } from './DatabaseExplorer'
import { ResizeHandle } from './ResizeHandle'
import { sidebarElementId, sidebarToggleId } from './SidebarToggle'
import { WorksheetExplorer } from './WorksheetExplorer'

const defaultSidebarWidth = 264
const maximumSidebarWidth = 380
const minimumSidebarWidth = 200

// Hiding the sidebar while focus is inside it would drop focus on the body, so
// it goes to the toggle that brings the sidebar back.
function useReturnFocusOnCollapse(collapsed: boolean) {
  const sidebarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!collapsed) {
      return
    }

    const sidebar = sidebarRef.current

    if (!sidebar?.contains(document.activeElement)) {
      return
    }

    document.getElementById(sidebarToggleId)?.focus()
  }, [collapsed])

  return sidebarRef
}

export function AppSidebar(): ReactElement {
  const collapsed = useAppSelector(
    (state) => state.ui.sidebarCollapsed ?? false
  )
  const sidebarRef = useReturnFocusOnCollapse(collapsed)

  const [width, setWidth] = usePersistedSize({
    defaultSize: defaultSidebarWidth,
    maximum: maximumSidebarWidth,
    minimum: minimumSidebarWidth,
    storageKey: 'ui:sidebarWidth'
  })

  // Hidden rather than unmounted: the explorers keep their scroll position,
  // their hotkeys and their loaded schemas, and the width state is untouched,
  // so expanding puts back exactly what was there.
  return (
    <div
      ref={sidebarRef}
      className="relative flex h-full min-h-0 flex-none flex-col border-r border-border bg-panel2"
      hidden={collapsed}
      id={sidebarElementId}
      style={{ width: `${width}px` }}
    >
      <div className="flex max-h-[44%] min-h-0 flex-col">
        <WorksheetExplorer />
      </div>

      <div className="my-1 h-px flex-none bg-border" />

      <div className="flex min-h-0 flex-1 flex-col">
        <DatabaseExplorer />
      </div>

      {/* Sits astride the right border so the 5px grab area straddles it,
          matching the design's `margin: 0 -2px` on a flex sibling. */}
      <ResizeHandle
        ariaLabel="Resize sidebar"
        className="absolute top-0 -right-[2px] h-full w-[5px]"
        maximum={maximumSidebarWidth}
        minimum={minimumSidebarWidth}
        orientation="col"
        size={width}
        onResize={setWidth}
      />
    </div>
  )
}
