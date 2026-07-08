import { Loader2Icon, PlayIcon } from 'lucide-react'
import { ReactElement } from 'react'

import { DatabaseSelector } from './DatabaseSelector'
import { Button } from './ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import { type SaveState } from '../hooks/useWorksheetAutosave'
import { type Statement } from '../sql-parser'

const runShortcut = navigator.platform.toLowerCase().includes('mac')
  ? '⌘ ↵'
  : 'Ctrl ↵'

interface WorksheetHeaderProps {
  activeStatement: Statement | null
  isQueryRunning: boolean
  saveState: SaveState
  onRunQuery: () => void
}

export function WorksheetHeader({
  activeStatement,
  isQueryRunning,
  saveState,
  onRunQuery
}: WorksheetHeaderProps): ReactElement {
  return (
    <header className="w-full p-3 border-b border-surface-0 flex items-center gap-3 justify-between">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <Button
              className="cursor-pointer"
              disabled={isQueryRunning || !activeStatement}
              size="icon-sm"
              onClick={onRunQuery}
            >
              {isQueryRunning ? (
                <Loader2Icon className="size-3 animate-spin" />
              ) : (
                <PlayIcon className="size-3" />
              )}
            </Button>
          </span>
        </TooltipTrigger>

        <TooltipContent side="bottom">
          {isQueryRunning ? (
            'Running…'
          ) : activeStatement ? (
            <span className="flex items-center gap-2">
              Run statement
              <kbd className="font-mono text-[10px] opacity-70">
                {runShortcut}
              </kbd>
            </span>
          ) : (
            'Place your cursor in a statement to run it'
          )}
        </TooltipContent>
      </Tooltip>

      <div className="flex items-center gap-3">
        <SaveIndicator state={saveState} />
        <DatabaseSelector />
      </div>
    </header>
  )
}

function SaveIndicator({ state }: { state: SaveState }): ReactElement | null {
  if (state === 'idle') {
    return null
  }

  const text =
    state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : 'Save failed'

  const className =
    state === 'error' ? 'text-red text-xs' : 'text-subtext-0 text-xs'

  return (
    <span
      className={`${className} motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300`}
    >
      {text}
    </span>
  )
}
