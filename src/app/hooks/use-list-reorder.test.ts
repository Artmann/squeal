import type {
  DragCancelEvent,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent
} from '@dnd-kit/core'
import {
  restrictToHorizontalAxis,
  restrictToVerticalAxis
} from '@dnd-kit/modifiers'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useListReorder, type DropIndicator } from './use-list-reorder'

const ids = ['a', 'b', 'c', 'd']

// dnd-kit only ever hands these handlers ids that belong to a rendered
// sortable, so the fixtures build the events it would build rather than
// exercising the DOM through a pointer.
function dragStart(id: string): DragStartEvent {
  return { active: { id } } as DragStartEvent
}

function dragOver(id: string | null): DragOverEvent {
  return { over: id === null ? null : { id } } as DragOverEvent
}

function dragEnd(activeId: string, overId: string | null): DragEndEvent {
  return {
    active: { id: activeId },
    over: overId === null ? null : { id: overId }
  } as DragEndEvent
}

function renderListReorder(onReorder = vi.fn()) {
  const rendered = renderHook(
    (props: { ids: string[] }) =>
      useListReorder({ axis: 'horizontal', ids: props.ids, onReorder }),
    { initialProps: { ids } }
  )

  return { ...rendered, onReorder }
}

// Reads the indicator of every id at once, so a test says what the whole list
// looks like rather than picking the one row it expects to have changed.
function indicators(
  dropIndicatorFor: (id: string) => DropIndicator,
  rows = ids
): Record<string, DropIndicator> {
  return Object.fromEntries(rows.map((id) => [id, dropIndicatorFor(id)]))
}

describe('useListReorder', () => {
  it('shows no indicator before a drag starts', () => {
    const { result } = renderListReorder()

    expect(indicators(result.current.dropIndicatorFor)).toEqual({
      a: null,
      b: null,
      c: null,
      d: null
    })
  })

  // Dragging forwards lands after the hovered row, matching how `arrayMove`
  // resolves the drop.
  it('marks a later row as the row to land after', () => {
    const { result } = renderListReorder()

    act(() => {
      result.current.dndContextProps.onDragStart(dragStart('a'))
      result.current.dndContextProps.onDragOver(dragOver('c'))
    })

    expect(indicators(result.current.dropIndicatorFor)).toEqual({
      a: null,
      b: null,
      c: 'after',
      d: null
    })
  })

  it('marks an earlier row as the row to land before', () => {
    const { result } = renderListReorder()

    act(() => {
      result.current.dndContextProps.onDragStart(dragStart('c'))
      result.current.dndContextProps.onDragOver(dragOver('a'))
    })

    expect(indicators(result.current.dropIndicatorFor)).toEqual({
      a: 'before',
      b: null,
      c: null,
      d: null
    })
  })

  // Dropping a row on itself changes nothing, so there is nothing to point at.
  it('shows no indicator over the row the drag started from', () => {
    const { result } = renderListReorder()

    act(() => {
      result.current.dndContextProps.onDragStart(dragStart('b'))
      result.current.dndContextProps.onDragOver(dragOver('b'))
    })

    expect(indicators(result.current.dropIndicatorFor)).toEqual({
      a: null,
      b: null,
      c: null,
      d: null
    })
  })

  it('shows no indicator once the pointer leaves every row', () => {
    const { result } = renderListReorder()

    act(() => {
      result.current.dndContextProps.onDragStart(dragStart('a'))
      result.current.dndContextProps.onDragOver(dragOver('c'))
      result.current.dndContextProps.onDragOver(dragOver(null))
    })

    expect(indicators(result.current.dropIndicatorFor)).toEqual({
      a: null,
      b: null,
      c: null,
      d: null
    })
  })

  // Escape during a drag. The release the caller used to wire by hand — and
  // could forget, leaving the line on screen for the rest of the session.
  it('clears the indicator when the drag is cancelled', () => {
    const { onReorder, result } = renderListReorder()

    act(() => {
      result.current.dndContextProps.onDragStart(dragStart('a'))
      result.current.dndContextProps.onDragOver(dragOver('c'))
      result.current.dndContextProps.onDragCancel({} as DragCancelEvent)
    })

    expect({
      indicators: indicators(result.current.dropIndicatorFor),
      reorders: onReorder.mock.calls
    }).toEqual({
      indicators: { a: null, b: null, c: null, d: null },
      reorders: []
    })
  })

  it('reports the whole reordered list and clears the indicator', () => {
    const { onReorder, result } = renderListReorder()

    act(() => {
      result.current.dndContextProps.onDragStart(dragStart('a'))
      result.current.dndContextProps.onDragOver(dragOver('c'))
      result.current.dndContextProps.onDragEnd(dragEnd('a', 'c'))
    })

    expect({
      indicators: indicators(result.current.dropIndicatorFor),
      reorders: onReorder.mock.calls
    }).toEqual({
      indicators: { a: null, b: null, c: null, d: null },
      reorders: [[['b', 'c', 'a', 'd']]]
    })
  })

  it('reorders nothing when a row is dropped on itself', () => {
    const { onReorder, result } = renderListReorder()

    act(() => {
      result.current.dndContextProps.onDragStart(dragStart('b'))
      result.current.dndContextProps.onDragEnd(dragEnd('b', 'b'))
    })

    expect(onReorder.mock.calls).toEqual([])
  })

  it('reorders nothing when the drop lands outside the list', () => {
    const { onReorder, result } = renderListReorder()

    act(() => {
      result.current.dndContextProps.onDragStart(dragStart('b'))
      result.current.dndContextProps.onDragEnd(dragEnd('b', null))
    })

    expect(onReorder.mock.calls).toEqual([])
  })

  // The four handlers travel together in one object, so a call site spreads
  // them onto `DndContext` and cannot wire three of them.
  it('hands the context every handler the lifecycle needs', () => {
    const { result } = renderListReorder()

    expect(
      Object.entries(result.current.dndContextProps)
        .filter(([name]) => name.startsWith('onDrag'))
        .map(([name, value]) => [name, typeof value])
        .sort()
    ).toEqual([
      ['onDragCancel', 'function'],
      ['onDragEnd', 'function'],
      ['onDragOver', 'function'],
      ['onDragStart', 'function']
    ])
  })

  it('restricts the drag to the axis the list runs along', () => {
    const { result } = renderListReorder()

    expect(result.current.dndContextProps.modifiers).toEqual([
      restrictToHorizontalAxis
    ])
  })

  // The two sidebars are the vertical ones, and nothing else in this file
  // renders that axis — without this, corrupting only the vertical entry lets
  // a user drag sidebar rows sideways out of their list with the suite green.
  it('restricts a vertical list to the vertical axis', () => {
    const { result } = renderHook(() =>
      useListReorder({ axis: 'vertical', ids, onReorder: vi.fn() })
    )

    expect(result.current.dndContextProps.modifiers).toEqual([
      restrictToVerticalAxis
    ])
  })

  // The whole reason `dropIndicatorFor` takes an id: the rows on screen are a
  // subsequence of the reorder list, never the list itself. Direction is read
  // off `ids`, and the two rendered rows here are neither adjacent in it nor
  // at the same distance apart, so an implementation that quietly assumed the
  // rendered list would have to reach a different answer.
  it('reads the direction off the reorder list, not the rendered rows', () => {
    const { result } = renderListReorder()

    act(() => {
      result.current.dndContextProps.onDragStart(dragStart('d'))
      result.current.dndContextProps.onDragOver(dragOver('b'))
    })

    expect(indicators(result.current.dropIndicatorFor, ['b', 'd'])).toEqual({
      b: 'before',
      d: null
    })
  })

  // dnd-kit reported a row the reorder list has never heard of. `indexOf`
  // answers -1, which reads as a position and puts a line on the wrong side of
  // every row unless it is caught.
  it('shows no indicator for a row outside the reorder list', () => {
    const { result } = renderListReorder()

    act(() => {
      result.current.dndContextProps.onDragStart(dragStart('a'))
      result.current.dndContextProps.onDragOver(dragOver('z'))
    })

    expect(result.current.dropIndicatorFor('z')).toEqual(null)
  })

  // A worksheet deleted while its tab is mid-drag takes the dragged id out of
  // the list under the drag.
  it('shows no indicator once the dragged row leaves the list', () => {
    const { rerender, result } = renderListReorder()

    act(() => {
      result.current.dndContextProps.onDragStart(dragStart('a'))
      result.current.dndContextProps.onDragOver(dragOver('c'))
    })

    rerender({ ids: ['b', 'c', 'd'] })

    expect(
      indicators(result.current.dropIndicatorFor, ['b', 'c', 'd'])
    ).toEqual({ b: null, c: null, d: null })
  })

  it('reorders nothing when the dragged row has left the list', () => {
    const { onReorder, rerender, result } = renderListReorder()

    act(() => {
      result.current.dndContextProps.onDragStart(dragStart('a'))
    })

    rerender({ ids: ['b', 'c', 'd'] })

    act(() => {
      result.current.dndContextProps.onDragEnd(dragEnd('a', 'c'))
    })

    expect(onReorder.mock.calls).toEqual([])
  })

  // What makes "hovering a row while dragging nothing" unrepresentable rather
  // than a state the reader has to rule out downstream.
  it('ignores a hover that arrives before any drag has started', () => {
    const { result } = renderListReorder()

    act(() => {
      result.current.dndContextProps.onDragOver(dragOver('c'))
    })

    expect(indicators(result.current.dropIndicatorFor)).toEqual({
      a: null,
      b: null,
      c: null,
      d: null
    })
  })

  // The old pair of `useState`s kept `overId` across drags, so a second drag
  // began with a line already drawn where the first one ended.
  it('starts a second drag with nothing hovered', () => {
    const { result } = renderListReorder()

    act(() => {
      result.current.dndContextProps.onDragStart(dragStart('a'))
      result.current.dndContextProps.onDragOver(dragOver('c'))
      result.current.dndContextProps.onDragStart(dragStart('b'))
    })

    expect(indicators(result.current.dropIndicatorFor)).toEqual({
      a: null,
      b: null,
      c: null,
      d: null
    })
  })
})
