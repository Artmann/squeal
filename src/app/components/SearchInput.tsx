import { SearchIcon, XIcon } from 'lucide-react'
import { KeyboardEvent, memo, ReactElement, RefObject, useRef } from 'react'

import { Input } from './ui/input'
import { cn } from '../lib/utils'

interface SearchInputProps {
  className?: string
  // Off by default because Escape already means something to some callers:
  // find in results closes on it and keeps its query for the next time it
  // opens, so clearing there would lose the query.
  clearOnEscape?: boolean
  // Named rather than React 19's ref-as-prop, so it survives `memo` without
  // depending on how the wrapper forwards refs. Same shape as
  // `WorksheetNameInput`.
  inputRef?: RefObject<HTMLInputElement | null>
  placeholder: string
  value: string
  onChange: (newValue: string) => void
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void
}

export const SearchInput = memo(function SearchInput({
  className,
  clearOnEscape = false,
  inputRef,
  placeholder,
  value,
  onChange,
  onKeyDown
}: SearchInputProps): ReactElement {
  const ownInputRef = useRef<HTMLInputElement>(null)
  const resolvedInputRef = inputRef ?? ownInputRef
  const hasValue = value !== ''

  const handleClear = (): void => {
    onChange('')
    resolvedInputRef.current?.focus()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    onKeyDown?.(event)

    if (
      !clearOnEscape ||
      event.defaultPrevented ||
      event.key !== 'Escape' ||
      !hasValue
    ) {
      return
    }

    event.preventDefault()
    onChange('')
  }

  return (
    <div className="relative">
      <Input
        ref={resolvedInputRef}
        className={cn(
          'h-7 rounded-[6px] border border-border bg-panel py-0 pr-[10px] pl-[27px] shadow-none',
          // The base input steps up to 14px at `md`, which every desktop
          // window clears, so the size is pinned at both breakpoints.
          'text-xs md:text-xs',
          'focus-visible:border-accent focus-visible:ring-0',
          // Room for the clear button, so long text runs under it rather than
          // behind it.
          hasValue && 'pr-[26px]',
          className
        )}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
      />

      <SearchIcon className="pointer-events-none absolute top-1/2 left-[9px] size-3 -translate-y-1/2 text-text3" />

      {hasValue && (
        <button
          aria-label="Clear search"
          className="absolute top-1/2 right-[4px] flex size-[20px] -translate-y-1/2 items-center justify-center rounded-[4px] text-text3 hover:bg-hover hover:text-text"
          title="Clear search"
          type="button"
          onClick={handleClear}
        >
          <XIcon className="size-3" />
        </button>
      )}
    </div>
  )
})
