import { MinusIcon, SquareIcon, XIcon } from 'lucide-react'
import { ReactElement } from 'react'

import { cn } from '@/app/lib/utils'

const isMac = navigator.platform.toLowerCase().includes('mac')

export function TitleBar(): ReactElement {
  const handleMinimize = () => {
    window.electron.windowMinimize()
  }

  const handleMaximize = () => {
    window.electron.windowMaximize()
  }

  const handleClose = () => {
    window.electron.windowClose()
  }

  return (
    <div className="title-bar relative h-7 flex items-center justify-between bg-mantle border-b border-surface-0 select-none">
      <div className="flex-1 drag-region h-full" />

      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span className="font-display text-[13px] font-semibold tracking-tight text-subtext-0 select-none">
          Squeal
        </span>
      </div>

      {!isMac && (
        <div className="flex h-full">
          <WindowButton onClick={handleMinimize}>
            <MinusIcon className="size-4" />
          </WindowButton>

          <WindowButton onClick={handleMaximize}>
            <SquareIcon className="size-3" />
          </WindowButton>

          <WindowButton
            className="hover:bg-red hover:text-base"
            onClick={handleClose}
          >
            <XIcon className="size-4" />
          </WindowButton>
        </div>
      )}
    </div>
  )
}

interface WindowButtonProps {
  children: React.ReactNode
  className?: string
  onClick: () => void
}

function WindowButton({
  children,
  className,
  onClick
}: WindowButtonProps): ReactElement {
  return (
    <button
      className={cn(
        'w-12 h-full flex items-center justify-center text-subtext-0 hover:bg-surface-1 hover:text-text transition-colors',
        className
      )}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  )
}
