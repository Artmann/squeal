import * as React from 'react'

import { cn } from '@/app/lib/utils'

interface SwitchProps extends Omit<
  React.ComponentProps<'button'>,
  'onChange' | 'type' | 'value'
> {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

// A plain button rather than Radix: this is the only switch in the app, and a
// `role="switch"` button with `aria-checked` is the whole accessible contract.
function Switch({
  checked,
  className,
  onCheckedChange,
  ...props
}: SwitchProps) {
  return (
    <button
      aria-checked={checked}
      className={cn(
        'relative inline-flex h-[18px] w-8 flex-none items-center rounded-full border border-border transition-colors',
        'focus-visible:ring-accent/50 outline-none focus-visible:ring-[3px]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-accent' : 'bg-panel2',
        className
      )}
      data-slot="switch"
      onClick={() => onCheckedChange(!checked)}
      role="switch"
      type="button"
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-3 rounded-full transition-transform',
          checked ? 'translate-x-[16px] bg-white' : 'translate-x-[2px] bg-text3'
        )}
      />
    </button>
  )
}

export { Switch }
