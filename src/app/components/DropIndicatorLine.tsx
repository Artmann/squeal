import { ReactElement } from 'react'

import { cn } from '../lib/utils'

interface DropIndicatorLineProps {
  orientation: 'horizontal' | 'vertical'
  position: 'after' | 'before'
}

// Renders inside a `relative` row wrapper, centered in the list's gap. The
// orientation is the list's, not the line's: a vertical list gets a horizontal
// rule between rows, a horizontal one gets an upright rule between tabs.
export function DropIndicatorLine({
  orientation,
  position
}: DropIndicatorLineProps): ReactElement {
  const isVertical = orientation === 'vertical'

  return (
    <div
      className={cn(
        'absolute rounded-full bg-accent pointer-events-none z-10',
        isVertical ? 'inset-x-0 h-0.5' : 'inset-y-0 w-0.5',
        isVertical && position === 'before' && '-top-[3px]',
        isVertical && position === 'after' && '-bottom-[3px]',
        !isVertical && position === 'before' && '-left-[1px]',
        !isVertical && position === 'after' && '-right-[1px]'
      )}
    />
  )
}
