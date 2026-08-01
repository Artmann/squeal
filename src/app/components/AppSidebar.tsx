import { ReactElement } from 'react'

import { usePersistedSize } from '../hooks/use-persisted-size'
import { DatabaseExplorer } from './DatabaseExplorer'
import { ResizeHandle } from './ResizeHandle'
import { WorksheetExplorer } from './WorksheetExplorer'

const defaultSidebarWidth = 264
const maximumSidebarWidth = 380
const minimumSidebarWidth = 200

export function AppSidebar(): ReactElement {
  const [width, setWidth] = usePersistedSize({
    defaultSize: defaultSidebarWidth,
    maximum: maximumSidebarWidth,
    minimum: minimumSidebarWidth,
    storageKey: 'ui:sidebarWidth'
  })

  return (
    <div
      className="relative flex h-full min-h-0 flex-none flex-col border-r border-border bg-panel2"
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
        orientation="col"
        size={width}
        onResize={setWidth}
      />
    </div>
  )
}
