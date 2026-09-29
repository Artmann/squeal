import { MinusIcon, MoonIcon, SquareIcon, SunIcon, XIcon } from 'lucide-react'
import { ReactElement, ReactNode } from 'react'

import { useTheme } from '@/app/hooks/useTheme'
import { cn } from '@/app/lib/utils'

const isMac = navigator.platform.toLowerCase().includes('mac')

const handleClose = () => {
  void window.electron.windowClose()
}

const handleMaximize = () => {
  void window.electron.windowMaximize()
}

const handleMinimize = () => {
  void window.electron.windowMinimize()
}

interface TitleBarProps {
  // Passed in rather than rendered here, because the title bar also sits on
  // screens that have no sidebar to toggle.
  sidebarToggle?: ReactNode
}

export function TitleBar({ sidebarToggle }: TitleBarProps): ReactElement {
  // `pointer-events-auto` because a modal Radix dialog sets `pointer-events:
  // none` on `<body>` while it is open. The editor screen is one, and it stops
  // short of the title bar on purpose, so the window buttons and the theme
  // toggle have to keep working under it.
  return (
    <div className="title-bar pointer-events-auto relative h-10 flex items-center bg-panel2 border-b border-border select-none">
      <div className="flex-1 drag-region h-full" />

      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span className="text-[13px] font-semibold tracking-[0.01em] text-text2 select-none">
          Squeal
        </span>
      </div>

      {/* A drag region as well, so only the button itself stops the drag —
          `.title-bar button` sets `-webkit-app-region: no-drag`. */}
      <div className="flex items-center gap-1 pr-[10px] drag-region h-full">
        {sidebarToggle}

        <ThemeToggle />
      </div>

      {!isMac && (
        <div className="flex h-full">
          <WindowButton
            label="Minimize"
            onClick={handleMinimize}
          >
            <MinusIcon className="size-4" />
          </WindowButton>

          <WindowButton
            label="Maximize"
            onClick={handleMaximize}
          >
            <SquareIcon className="size-3" />
          </WindowButton>

          <WindowButton
            className="hover:bg-err hover:text-white"
            label="Close"
            onClick={handleClose}
          >
            <XIcon className="size-4" />
          </WindowButton>
        </div>
      )}
    </div>
  )
}

function ThemeToggle(): ReactElement {
  const { resolvedMode, toggleMode } = useTheme()

  const isDark = resolvedMode === 'dark'
  const label = isDark ? 'Switch to light theme' : 'Switch to dark theme'

  return (
    <button
      aria-label={label}
      className="size-7 flex items-center justify-center rounded-sm text-text2 hover:bg-hover transition-colors"
      onClick={toggleMode}
      title={label}
      type="button"
    >
      {isDark ? (
        <SunIcon className="size-[15px]" />
      ) : (
        <MoonIcon className="size-[15px]" />
      )}
    </button>
  )
}

interface WindowButtonProps {
  children: React.ReactNode
  className?: string
  label: string
  onClick: () => void
}

function WindowButton({
  children,
  className,
  label,
  onClick
}: WindowButtonProps): ReactElement {
  return (
    <button
      aria-label={label}
      className={cn(
        'w-12 h-full flex items-center justify-center text-text2 hover:bg-hover hover:text-text transition-colors',
        className
      )}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  )
}
