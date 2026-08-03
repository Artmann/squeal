import React, { ReactElement } from 'react'

import { cn } from '../lib/utils'
import { Input } from './ui/input'

interface WorksheetNameInputProps {
  ariaLabel: string
  className?: string
  editingName: string
  inputRef: React.RefObject<HTMLInputElement | null>
  worksheetId: string
  onEditingNameChange: (name: string) => void
  onKeyDown: (event: React.KeyboardEvent, worksheetId: string) => void
  onRenameSubmit: (worksheetId: string) => void
}

// The rename field itself, shared by the sidebar list and the tab strip. Both
// commit on blur, so clicking away is a save rather than a silent discard; the
// callers only differ in how they wrap and size it.
export function WorksheetNameInput({
  ariaLabel,
  className,
  editingName,
  inputRef,
  worksheetId,
  onEditingNameChange,
  onKeyDown,
  onRenameSubmit
}: WorksheetNameInputProps): ReactElement {
  return (
    <Input
      ref={inputRef}
      aria-label={ariaLabel}
      className={cn(
        'h-[22px] rounded-[4px] px-1 py-0 text-[12.5px] shadow-none md:text-[12.5px] focus-visible:ring-0',
        className
      )}
      value={editingName}
      onBlur={() => onRenameSubmit(worksheetId)}
      onChange={(event) => onEditingNameChange(event.target.value)}
      onKeyDown={(event) => onKeyDown(event, worksheetId)}
    />
  )
}
