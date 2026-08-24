import { type ComponentProps, type ReactElement, useCallback } from 'react'
import { FolderOpenIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/app/components/ui/button'
import { FormControl } from '@/app/components/ui/form'
import { Input } from '@/app/components/ui/input'
import type { FileDialogKind } from '@/glue/file-dialogs'

interface FilePathInputProps extends ComponentProps<'input'> {
  // The button carries only an icon, so without this it has no accessible name
  // — unreachable by a screen reader and by `getByRole('button', { name })`.
  browseLabel: string
  dialogKind: FileDialogKind
  onFileSelected: (filePath: string) => void
}

/**
 * A path field with a native picker beside it.
 *
 * Typing stays the point — someone who already has the path should not have to
 * go through a dialog for it — so the picker only ever fills the field in.
 *
 * `FormControl` is rendered here rather than by the caller because it is a
 * Radix `Slot` and has to wrap exactly one child: the flex row holding the
 * button has to sit outside it.
 */
export function FilePathInput({
  browseLabel,
  dialogKind,
  onFileSelected,
  ...inputProps
}: FilePathInputProps): ReactElement {
  const browse = useCallback(async () => {
    try {
      const filePath = await window.electron.openFileDialog(dialogKind)

      // Null is the cancel: leave whatever is already typed alone.
      if (filePath !== null) {
        onFileSelected(filePath)
      }
    } catch (error) {
      // The reason is never something the user can act on — it is an ipc or
      // dialog failure — so the toast says what to do instead and the detail
      // goes to the console, where the renderer's error tracing picks it up.
      console.error('Open file dialog error:', error)

      toast.error('Could not open the file picker', {
        description: 'Type the path into the field instead.'
      })
    }
  }, [dialogKind, onFileSelected])

  return (
    <div className="flex gap-2">
      <FormControl>
        <Input
          className="flex-1"
          type="text"
          {...inputProps}
        />
      </FormControl>

      <Button
        aria-label={browseLabel}
        size="icon"
        type="button"
        variant="outline"
        onClick={() => {
          void browse()
        }}
      >
        <FolderOpenIcon className="h-4 w-4" />
      </Button>
    </div>
  )
}
