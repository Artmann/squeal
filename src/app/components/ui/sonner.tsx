import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon
} from 'lucide-react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

import { useThemeContext } from '../ThemeProvider'

const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedMode } = useThemeContext()

  return (
    <Sonner
      theme={resolvedMode as ToasterProps['theme']}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />
      }}
      style={
        {
          '--normal-bg': 'var(--color-surface-0)',
          '--normal-text': 'var(--color-text)',
          '--normal-border': 'var(--color-surface-2)',
          '--border-radius': 'var(--radius-md)'
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
