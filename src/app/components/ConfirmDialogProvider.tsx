import { createContext, useCallback, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import invariant from 'tiny-invariant'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/app/components/ui/alert-dialog'

export type ConfirmOptions = {
  confirmLabel: string
  description: string
  onConfirm: () => void
  title: string
}

const ConfirmContext = createContext<
  ((options: ConfirmOptions) => void) | null
>(null)

export function useConfirm(): (options: ConfirmOptions) => void {
  const confirm = useContext(ConfirmContext)

  invariant(
    confirm,
    'useConfirm was called outside a ConfirmDialogProvider. Wrap the tree in one.'
  )

  return confirm
}

// One dialog for the whole app, asked for imperatively. The shape mirrors the
// action toast this replaced -- a title, a description and the callback the
// confirm button runs -- so a caller never holds "is the dialog open" state of
// its own, and the worksheet explorer can confirm a whole selection without
// parking it somewhere first.
export function ConfirmDialogProvider({
  children
}: {
  children: ReactNode
}): ReactNode {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)

  const confirm = useCallback((options: ConfirmOptions) => {
    setOptions(options)
  }, [])

  // Closing drops the options rather than just flipping an `open` flag, so the
  // callback -- and whatever it closes over, which for worksheets is the whole
  // selection -- is released as soon as the question is answered. The cost is
  // the exit animation: the content unmounts with the state instead of fading.
  const close = useCallback(() => {
    setOptions(null)
  }, [])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}

      <AlertDialog
        open={options !== null}
        onOpenChange={(open) => {
          if (!open) {
            close()
          }
        }}
      >
        {options && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{options.title}</AlertDialogTitle>

              <AlertDialogDescription>
                {options.description}
              </AlertDialogDescription>
            </AlertDialogHeader>

            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>

              <AlertDialogAction onClick={options.onConfirm}>
                {options.confirmLabel}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </ConfirmContext.Provider>
  )
}
