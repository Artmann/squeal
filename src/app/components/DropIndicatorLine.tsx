import { ReactElement } from 'react'

import { cn } from '../lib/utils'

interface DropIndicatorLineProps {
  position: 'above' | 'below'
}

// Renders inside a `relative` row wrapper, centered in the list's gap.
export function DropIndicatorLine({
  position
}: DropIndicatorLineProps): ReactElement {
  return (
    <div
      className={cn(
        'absolute inset-x-0 h-0.5 rounded-full bg-accent pointer-events-none z-10',
        position === 'above' ? '-top-[3px]' : '-bottom-[3px]'
      )}
    />
  )
}
