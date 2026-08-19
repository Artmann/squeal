import * as React from 'react'

import { cn } from '@/app/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'file:text-text placeholder:text-text3 selection:bg-sel selection:text-text border-border bg-panel2 h-8 w-full min-w-0 rounded-sm border px-[10px] py-1 text-[12.5px] transition-[color,border-color] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-[12.5px] text-text',
        // The design's fields draw focus with the border alone — no ring.
        'focus-visible:border-accent',
        'aria-invalid:ring-err/20 aria-invalid:border-err',
        className
      )}
      {...props}
    />
  )
}

export { Input }
