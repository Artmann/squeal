import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/app/lib/utils'

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-accent focus-visible:ring-accent/50 focus-visible:ring-[3px] aria-invalid:ring-err/20 aria-invalid:border-err",
  {
    variants: {
      variant: {
        default: 'bg-accent-btn text-white hover:bg-accent-btn/90',
        primary: 'bg-accent-btn text-white hover:brightness-110',
        destructive:
          'bg-err text-white hover:bg-err/90 focus-visible:ring-err/20',
        outline: 'border bg-panel shadow-xs hover:bg-hover hover:text-text',
        secondary: 'bg-hover text-text hover:bg-hover/80',
        ghost: 'hover:bg-hover hover:text-text',
        link: 'text-accent underline-offset-4 hover:underline'
      },
      size: {
        default: 'h-[29px] gap-[7px] px-[11px] text-[12.5px]',
        sm: 'h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5',
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
        icon: 'size-7',
        'icon-sm': 'size-[22px]',
        'icon-lg': 'size-10'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button }
