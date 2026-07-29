import { ActivityIcon } from 'lucide-react'
import { ReactElement } from 'react'

import { useAppDispatch } from '../store'
import { uiActions } from '../store/ui-slice'
import { Button } from './ui/button'
import { Separator } from './ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { DatabaseExplorer } from './DatabaseExplorer'
import { WorksheetExplorer } from './WorksheetExplorer'

export function AppSidebar(): ReactElement {
  const dispatch = useAppDispatch()

  return (
    <div className="flex flex-col gap-2 text-xs w-80 h-full">
      <div className="flex-[2] min-h-0 p-3">
        <WorksheetExplorer />
      </div>

      <Separator />

      <div className="flex-[3] min-h-0 p-3">
        <DatabaseExplorer />
      </div>

      <div className="flex items-center border-t border-surface-0 px-3 py-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label="Open traces"
              onClick={() => dispatch(uiActions.toggleTraceDashboard())}
              size="icon-sm"
              variant="ghost"
            >
              <ActivityIcon className="size-3" />
            </Button>
          </TooltipTrigger>

          <TooltipContent side="top">Traces ⌘⇧T</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
