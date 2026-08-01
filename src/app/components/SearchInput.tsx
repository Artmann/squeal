import { SearchIcon } from 'lucide-react'
import { memo, ReactElement } from 'react'

import { Input } from './ui/input'
import { cn } from '../lib/utils'

interface SearchInputProps {
  className?: string
  placeholder: string
  value: string
  onChange: (newValue: string) => void
}

export const SearchInput = memo(function SearchInput({
  className,
  placeholder,
  value,
  onChange
}: SearchInputProps): ReactElement {
  return (
    <div className="relative">
      <Input
        className={cn(
          'h-7 rounded-[6px] border border-border bg-panel py-0 pr-[10px] pl-[27px] shadow-none',
          // The base input steps up to 14px at `md`, which every desktop
          // window clears, so the size is pinned at both breakpoints.
          'text-xs md:text-xs',
          'focus-visible:border-accent focus-visible:ring-0',
          className
        )}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />

      <SearchIcon className="pointer-events-none absolute top-1/2 left-[9px] size-3 -translate-y-1/2 text-text3" />
    </div>
  )
})
