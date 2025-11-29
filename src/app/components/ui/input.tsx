import * as React from 'react'

import { cn } from '@/app/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'file:text-text placeholder:text-subtext-0 selection:bg-blue selection:text-base border-surface-1 h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm text-text',
        'focus-visible:border-lavender focus-visible:ring-lavender/50 focus-visible:ring-[3px]',
        'aria-invalid:ring-red/20 aria-invalid:border-red',
        className
      )}
      {...props}
    />
  )
}

export { Input }
