import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'fs'
import { join } from 'path'
import { ReactElement, useState } from 'react'
import { describe, expect, it } from 'vitest'

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from './context-menu'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogOverlay,
  DialogTitle
} from './dialog'

// The shape of "Edit" on a database row: a context menu item mounts a dialog
// that is always open and is unmounted to close it, the way `EditorScreen` is.
function EditFromContextMenu(): ReactElement {
  const [isEditing, setIsEditing] = useState(false)

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger>
          <button type="button">Pagila</button>
        </ContextMenuTrigger>

        <ContextMenuContent>
          <ContextMenuItem onClick={() => setIsEditing(true)}>
            Edit
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {isEditing && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setIsEditing(false)
            }
          }}
        >
          <DialogOverlay>
            <DialogContent aria-describedby={undefined}>
              <DialogTitle>Edit database</DialogTitle>

              <DialogClose>Close</DialogClose>
            </DialogContent>
          </DialogOverlay>
        </Dialog>
      )}
    </>
  )
}

describe('modal layers', () => {
  // Radix blocks pointer events on <body> while a modal layer is open and puts
  // back the value it found when the last one closes. That bookkeeping lives in
  // module state inside @radix-ui/react-dismissable-layer, so two installed
  // copies keep two records: the dialog's copy opened while the menu's copy had
  // already set `none`, took `none` for the original, and restored it on close.
  // Every click then landed on <html>, and the window looked frozen.
  it('gives the body its pointer events back after a dialog opened from a context menu closes', async () => {
    const user = userEvent.setup()

    render(<EditFromContextMenu />)

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Pagila' }))

    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    await user.click(await screen.findByRole('button', { name: 'Close' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    expect(document.body.style.pointerEvents).toEqual('')
  })

  // The test above is the behaviour, but with two copies installed it does not
  // fail so much as hang: the copies' focus traps hand focus back and forth
  // until the worker overflows its stack. This says the same thing in a line.
  // If it fails, upgrade every @radix-ui package together
  // (`yarn upgrade --latest --pattern @radix-ui`) rather than one of them.
  it('installs one version of each Radix package', () => {
    const lockfile = readFileSync(
      join(import.meta.dirname, '..', '..', '..', '..', 'yarn.lock'),
      'utf8'
    )

    const versionsByPackage = new Map<string, Set<string>>()

    for (const match of lockfile.matchAll(
      /^"?(@radix-ui\/[^@"]+)@[^\n]*\n {2}version "([^"]+)"/gm
    )) {
      const [, packageName, version] = match
      const versions = versionsByPackage.get(packageName) ?? new Set<string>()

      versions.add(version)
      versionsByPackage.set(packageName, versions)
    }

    const duplicated = [...versionsByPackage]
      .filter(([, versions]) => versions.size > 1)
      .map(
        ([packageName, versions]) =>
          `${packageName}@${[...versions].join(', ')}`
      )

    expect(versionsByPackage.size).toBeGreaterThan(0)
    expect(duplicated).toEqual([])
  })
})
