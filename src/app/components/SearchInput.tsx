import { SearchIcon } from 'lucide-react'
import { memo, ReactElement } from 'react'

import { Input } from './ui/input'
import { cn } from '../lib/utils'

interface SearchInputProps {
  className?: string
  value: string
  onChange: (newValue: string) => void
}

export const SearchInput = memo(function SearchInput({
  className,
  value,
  onChange
}: SearchInputProps): ReactElement {
  return (
    <div className="relative">
      <Input
        className={cn('h-7 pl-7 py-0 text-[12px]', className)}
        placeholder="Search..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />

      <SearchIcon className="absolute size-3 left-3 top-1/2 -translate-y-1/2" />
    </div>
  )
})
