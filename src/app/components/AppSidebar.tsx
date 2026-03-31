import { ReactElement } from 'react'

import { Separator } from './ui/separator'
import { DatabaseExplorer } from './DatabaseExplorer'
import { WorksheetExplorer } from './WorksheetExplorer'

export function AppSidebar(): ReactElement {
  return (
    <div className="flex flex-col gap-2 text-xs w-80 h-full">
      <div className="flex-[2] min-h-0 p-3">
        <WorksheetExplorer />
      </div>

      <Separator />

      <div className="flex-[3] min-h-0 p-3">
        <DatabaseExplorer />
      </div>
    </div>
  )
}
