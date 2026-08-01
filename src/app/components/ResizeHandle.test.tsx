import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ResizeHandle } from './ResizeHandle'

describe('ResizeHandle', () => {
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

  it('stops resizing once the pointer is released', () => {
    const onResize = vi.fn()
    const onResizeEnd = vi.fn()

    render(
      <ResizeHandle
        ariaLabel="Resize sidebar"
        orientation="col"
        size={264}
        onResize={onResize}
        onResizeEnd={onResizeEnd}
      />
    )

    fireEvent.mouseDown(screen.getByRole('separator'), { clientX: 100 })
    fireEvent.mouseUp(document)
    fireEvent.mouseMove(document, { clientX: 300 })

    expect(onResize).not.toHaveBeenCalled()
    expect(onResizeEnd).toHaveBeenCalledTimes(1)
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
