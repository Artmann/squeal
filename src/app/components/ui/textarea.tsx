import * as React from 'react'

import { cn } from '@/app/lib/utils'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'border-surface-1 placeholder:text-subtext-0 focus-visible:border-lavender focus-visible:ring-lavender/50 aria-invalid:ring-red/20 aria-invalid:border-red flex field-sizing-content min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
