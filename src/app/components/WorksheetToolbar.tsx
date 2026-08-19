import { Loader2Icon, PlayIcon } from 'lucide-react'
import { ReactElement } from 'react'

import { ConnectionPicker } from './ConnectionPicker'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { type Statement } from '../sql-parser'

interface WorksheetToolbarProps {
  activeStatement: Statement | null
  isCanceling: boolean
  isQueryRunning: boolean
  onCancelQuery: () => void
  onRunQuery: () => void
}

export function WorksheetToolbar({
  activeStatement,
  isCanceling,
  isQueryRunning,
  onCancelQuery,
  onRunQuery
}: WorksheetToolbarProps): ReactElement {
  const isRunDisabled = isQueryRunning || !activeStatement

  const tooltip = isQueryRunning
    ? 'Running…'
    : activeStatement
      ? 'Run statement'
      : 'Place your cursor in a statement to run it.'

  return (
    <div className="flex h-[46px] flex-none items-center gap-2 border-b border-border2 bg-panel px-3">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <Button
              className="cursor-pointer"
              disabled={isRunDisabled}
              variant="primary"
              onClick={onRunQuery}
            >
              {isQueryRunning ? (
                <Loader2Icon className="size-[11px] animate-spin" />
              ) : (
                <PlayIcon className="size-[10px] fill-current" />
              )}

              <span>Run</span>

              <kbd className="rounded-[4px] bg-white/[0.18] px-1 py-px text-[10.5px] font-normal">
                {runShortcut()}
              </kbd>
            </Button>
          </span>
        </TooltipTrigger>

        <TooltipContent side="bottom">{tooltip}</TooltipContent>
      </Tooltip>

      {isQueryRunning && (
        <Button
          className="cursor-pointer"
          disabled={isCanceling}
          variant="outline"
          onClick={onCancelQuery}
        >
          {isCanceling ? 'Canceling…' : 'Cancel'}
        </Button>
      )}

      <div className="ml-auto">
        <ConnectionPicker />
      </div>
    </div>
  )
}

// Read at render time so tests can stand in a different platform.
function runShortcut(): string {
  return navigator.platform.toLowerCase().includes('mac') ? '⌘↵' : 'Ctrl↵'
}
