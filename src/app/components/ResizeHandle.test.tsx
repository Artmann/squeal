import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ResizeHandle } from './ResizeHandle'

describe('ResizeHandle', () => {
  // The handle suppresses text selection on the body while dragging. A test
  // that leaked 'none' would hand the next one a poisoned starting value and
  // hide exactly the bug these tests are here to catch.
  beforeEach(() => {
    document.body.style.userSelect = ''
  })

  it('exposes a separator with the axis it resizes', () => {
    render(
      <ResizeHandle
        ariaLabel="Resize sidebar"
        orientation="col"
        size={264}
        onResize={vi.fn()}
      />
    )

    const handle = screen.getByRole('separator', { name: 'Resize sidebar' })

    expect(handle).toHaveAttribute('aria-orientation', 'vertical')
    expect(handle).toHaveClass('cursor-col-resize')
  })

  it('reports the new size while dragging along the x axis', () => {
    const onResize = vi.fn()

    render(
      <ResizeHandle
        ariaLabel="Resize sidebar"
        orientation="col"
        size={264}
        onResize={onResize}
      />
    )

    fireEvent.mouseDown(screen.getByRole('separator'), { clientX: 100 })
    fireEvent.mouseMove(document, { clientX: 130 })

    expect(onResize).toHaveBeenCalledWith(294)

    fireEvent.mouseMove(document, { clientX: 80 })

    expect(onResize).toHaveBeenLastCalledWith(244)
  })

  it('grows toward the start when the handle leads the panel', () => {
    const onResize = vi.fn()

    render(
      <ResizeHandle
        ariaLabel="Resize results panel"
        growsToward="start"
        orientation="row"
        size={400}
        onResize={onResize}
      />
    )

    const handle = screen.getByRole('separator')

    expect(handle).toHaveAttribute('aria-orientation', 'horizontal')
    expect(handle).toHaveClass('cursor-row-resize')

    fireEvent.mouseDown(handle, { clientY: 500 })
    fireEvent.mouseMove(document, { clientY: 460 })

    expect(onResize).toHaveBeenCalledWith(440)
  })

  it('ignores a mousedown from a button other than the primary one', () => {
    const onResize = vi.fn()

    render(
      <ResizeHandle
        ariaLabel="Resize sidebar"
        orientation="col"
        size={264}
        onResize={onResize}
      />
    )

    // Right-clicking opens the context menu, and the mouseup that follows
    // lands there rather than on the document.
    fireEvent.mouseDown(screen.getByRole('separator'), {
      button: 2,
      clientX: 100
    })
    fireEvent.mouseMove(document, { clientX: 300 })

    expect(onResize).not.toHaveBeenCalled()
    expect(document.body.style.userSelect).toEqual('')
  })

  it('stops resizing once the pointer is released', () => {
    const onResize = vi.fn()

    render(
      <ResizeHandle
        ariaLabel="Resize sidebar"
        orientation="col"
        size={264}
        onResize={onResize}
      />
    )

    fireEvent.mouseDown(screen.getByRole('separator'), { clientX: 100 })
    fireEvent.mouseUp(document)
    fireEvent.mouseMove(document, { clientX: 300 })

    expect(onResize).not.toHaveBeenCalled()
  })

  it('stops resizing when the handle unmounts mid-drag', () => {
    const onResize = vi.fn()

    const { unmount } = render(
      <ResizeHandle
        ariaLabel="Resize sidebar"
        orientation="col"
        size={264}
        onResize={onResize}
      />
    )

    fireEvent.mouseDown(screen.getByRole('separator'), { clientX: 100 })

    unmount()

    fireEvent.mouseMove(document, { clientX: 300 })

    expect(onResize).not.toHaveBeenCalled()
  })

  it('restores text selection when the handle unmounts mid-drag', () => {
    const { unmount } = render(
      <ResizeHandle
        ariaLabel="Resize sidebar"
        orientation="col"
        size={264}
        onResize={vi.fn()}
      />
    )

    fireEvent.mouseDown(screen.getByRole('separator'), { clientX: 100 })

    expect(document.body.style.userSelect).toEqual('none')

    unmount()

    expect(document.body.style.userSelect).toEqual('')
  })

  it('restores text selection when a drag starts after a lost mouseup', () => {
    render(
      <ResizeHandle
        ariaLabel="Resize sidebar"
        orientation="col"
        size={264}
        onResize={vi.fn()}
      />
    )

    const handle = screen.getByRole('separator')

    // The mouseup of the first drag never arrives: the button was released
    // outside the window, so document never sees the event.
    fireEvent.mouseDown(handle, { clientX: 100 })
    fireEvent.mouseDown(handle, { clientX: 100 })
    fireEvent.mouseUp(document)

    expect(document.body.style.userSelect).toEqual('')
  })

  it('restores text selection when another handle left a drag dangling', () => {
    // The app always has both of these mounted at once, and the body style
    // they fight over is global.
    render(
      <>
        <ResizeHandle
          ariaLabel="Resize sidebar"
          orientation="col"
          size={264}
          onResize={vi.fn()}
        />
        <ResizeHandle
          ariaLabel="Resize results panel"
          growsToward="start"
          orientation="row"
          size={400}
          onResize={vi.fn()}
        />
      </>
    )

    const resultsHandle = screen.getByRole('separator', {
      name: 'Resize results panel'
    })
    const sidebarHandle = screen.getByRole('separator', {
      name: 'Resize sidebar'
    })

    // The sidebar drag never gets its mouseup, so it is still holding the body
    // at 'none' when the results drag begins.
    fireEvent.mouseDown(sidebarHandle, { clientX: 100 })
    fireEvent.mouseDown(resultsHandle, { clientY: 500 })
    fireEvent.mouseUp(document)

    expect(document.body.style.userSelect).toEqual('')

    // And a later clean drag has to leave it recovered too.
    fireEvent.mouseDown(sidebarHandle, { clientX: 100 })
    fireEvent.mouseUp(document)

    expect(document.body.style.userSelect).toEqual('')
  })

  it('resizes by 10px with the arrow keys and 40px with shift', () => {
    const onResize = vi.fn()

    render(
      <ResizeHandle
        ariaLabel="Resize sidebar"
        orientation="col"
        size={264}
        onResize={onResize}
      />
    )

    const handle = screen.getByRole('separator')

    fireEvent.keyDown(handle, { key: 'ArrowRight' })

    expect(onResize).toHaveBeenLastCalledWith(274)

    fireEvent.keyDown(handle, { key: 'ArrowLeft' })

    expect(onResize).toHaveBeenLastCalledWith(254)

    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true })

    expect(onResize).toHaveBeenLastCalledWith(304)

    fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true })

    expect(onResize).toHaveBeenLastCalledWith(224)
  })

  it('maps the vertical arrow keys when it grows toward the start', () => {
    const onResize = vi.fn()

    render(
      <ResizeHandle
        ariaLabel="Resize results panel"
        growsToward="start"
        orientation="row"
        size={400}
        onResize={onResize}
      />
    )

    const handle = screen.getByRole('separator')

    fireEvent.keyDown(handle, { key: 'ArrowUp' })

    expect(onResize).toHaveBeenLastCalledWith(410)

    fireEvent.keyDown(handle, { key: 'ArrowDown' })

    expect(onResize).toHaveBeenLastCalledWith(390)
  })

  it('ignores keys on the other axis', () => {
    const onResize = vi.fn()

    render(
      <ResizeHandle
        ariaLabel="Resize sidebar"
        orientation="col"
        size={264}
        onResize={onResize}
      />
    )

    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowUp' })

    expect(onResize).not.toHaveBeenCalled()
  })
})
