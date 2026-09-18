import { CSSProperties, ReactElement } from 'react'

import { cn } from '../lib/utils'
import type { EnvironmentDto } from '@/glue/environments'

interface EnvironmentBadgeProps {
  className?: string
  /** Undefined for a connection with no environment, which renders nothing. */
  environment: EnvironmentDto | undefined
}

/**
 * Sets `--env-hue` for the `env` colour utilities. The hue travels as an inline
 * custom property rather than a class, because it is a stored number rather
 * than one of a fixed set Tailwind could have generated utilities for.
 *
 * Exported because the status bar tints itself with the same trio and needs the
 * same property in scope.
 */
export function environmentHueStyle(
  environment: EnvironmentDto
): CSSProperties {
  return { '--env-hue': String(environment.hue) } as CSSProperties
}

export function EnvironmentBadge({
  className,
  environment
}: EnvironmentBadgeProps): ReactElement | null {
  if (environment === undefined) {
    return null
  }

  return (
    <span
      className={cn(
        'flex-none truncate rounded-[4px] border border-env-border bg-env-bg px-[5px] py-[1.5px] text-[10px] text-env',
        className
      )}
      style={environmentHueStyle(environment)}
      title={environment.name}
    >
      {environment.name}
    </span>
  )
}
