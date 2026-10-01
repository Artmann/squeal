import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'

import { cn } from '@/app/lib/utils'

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return (
    <DialogPrimitive.Root
      data-slot="dialog"
      {...props}
    />
  )
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return (
    <DialogPrimitive.Close
      data-slot="dialog-close"
      {...props}
    />
  )
}

// Not portaled, unlike shadcn's: the overlay fills the screen slot it is
// rendered in and stops at the title bar. The window is frameless, so a
// full-window overlay would cover the only drag region and the only window
// buttons Windows and Linux get.
//
// It is also the scroller, with the content inside it, so a card taller than
// the window scrolls on the backdrop rather than being clipped. A pointerdown
// on the backdrop is still "outside" the content, which is what closes it.
function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'absolute inset-0 z-(--z-overlay) overflow-y-auto bg-bg/70',
        className
      )}
      {...props}
    />
  )
}

function isOverlay(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement && target.dataset.slot === 'dialog-overlay'
  )
}

function DialogContent({
  className,
  onCloseAutoFocus,
  onInteractOutside,
  onOpenAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  const returnFocusRef = React.useRef<Element | null>(null)

  return (
    <DialogPrimitive.Content
      data-slot="dialog-content"
      aria-modal="true"
      className={cn(
        'bg-panel text-text border-border rounded-md border shadow-[0_8px_24px_rgba(0,0,0,0.14)]',
        className
      )}
      // Radix returns focus to a `DialogTrigger` and to nothing else, and these
      // dialogs are opened from the store rather than from a trigger. So the
      // element that had focus is noted on the way in — before Radix moves it —
      // and handed focus back on the way out, if it is still on the page.
      onCloseAutoFocus={(event) => {
        onCloseAutoFocus?.(event)

        if (event.defaultPrevented) {
          return
        }

        event.preventDefault()

        const element = returnFocusRef.current

        if (element instanceof HTMLElement && element.isConnected) {
          element.focus()
        }
      }}
      // Only the backdrop closes the dialog. The title bar is outside the
      // content too, and its window buttons have to work without throwing
      // away a half-filled form.
      onInteractOutside={(event) => {
        onInteractOutside?.(event)

        if (!isOverlay(event.target)) {
          event.preventDefault()
        }
      }}
      onOpenAutoFocus={(event) => {
        returnFocusRef.current = document.activeElement
        onOpenAutoFocus?.(event)
      }}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-base font-semibold', className)}
      {...props}
    />
  )
}

export { Dialog, DialogClose, DialogContent, DialogOverlay, DialogTitle }
