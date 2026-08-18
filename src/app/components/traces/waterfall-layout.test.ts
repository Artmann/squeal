import { describe, expect, it } from 'vitest'

import type { SpanDto } from '@/glue/api/schemas'

import { computeWaterfallLayout, visibleRows } from './waterfall-layout'

function buildSpan(overrides: Partial<SpanDto>): SpanDto {
  return {
    attributes: {},
    durationMs: 10,
    events: [],
    id: 'span-id',
    kind: 'internal',
    name: 'span',
    parentSpanId: null,
    serviceName: 'main',
    startedAt: 1000,
    status: 'ok',
    statusMessage: null,
    traceId: 'trace-id',
    ...overrides
  }
}

describe('computeWaterfallLayout', () => {
  it('orders spans depth-first by start time', () => {
    const layout = computeWaterfallLayout([
      buildSpan({ id: 'child-2', parentSpanId: 'root', startedAt: 1080 }),
      buildSpan({ durationMs: 100, id: 'root', startedAt: 1000 }),
      buildSpan({ id: 'child-1', parentSpanId: 'root', startedAt: 1010 }),
      buildSpan({
        id: 'grandchild',
        parentSpanId: 'child-1',
        startedAt: 1020
      })
    ])

    expect(
      layout.rows.map((row) => ({ depth: row.depth, id: row.span.id }))
    ).toEqual([
      { depth: 0, id: 'root' },
      { depth: 1, id: 'child-1' },
      { depth: 2, id: 'grandchild' },
      { depth: 1, id: 'child-2' }
    ])
  })

  it('computes bar offsets relative to the trace extent', () => {
    const layout = computeWaterfallLayout([
      buildSpan({ durationMs: 100, id: 'root', startedAt: 1000 }),
      buildSpan({
        durationMs: 25,
        id: 'child',
        parentSpanId: 'root',
        startedAt: 1050
      })
    ])

    const child = layout.rows.find((row) => row.span.id === 'child')

    expect(layout.totalDurationMs).toEqual(100)
    expect(child?.leftPercent).toEqual(50)
    expect(child?.widthPercent).toEqual(25)
  })

  it('keeps very short spans visible', () => {
    const layout = computeWaterfallLayout([
      buildSpan({ durationMs: 10000, id: 'root', startedAt: 1000 }),
      buildSpan({
        durationMs: 0.1,
        id: 'blip',
        parentSpanId: 'root',
        startedAt: 1000
      })
    ])

    const blip = layout.rows.find((row) => row.span.id === 'blip')

    expect(blip?.widthPercent).toEqual(0.5)
  })

  it('treats spans with a missing parent as roots', () => {
    const layout = computeWaterfallLayout([
      buildSpan({ id: 'orphan', parentSpanId: 'not-ingested', startedAt: 1000 })
    ])

    expect(layout.rows).toEqual([
      expect.objectContaining({ depth: 0, hasChildren: false })
    ])
  })

  it('flags rows that have children', () => {
    const layout = computeWaterfallLayout([
      buildSpan({ id: 'root', startedAt: 1000 }),
      buildSpan({ id: 'child', parentSpanId: 'root', startedAt: 1001 })
    ])

    expect(layout.rows.map((row) => row.hasChildren)).toEqual([true, false])
  })
})

describe('visibleRows', () => {
  it('hides all descendants of collapsed rows', () => {
    const layout = computeWaterfallLayout([
      buildSpan({ durationMs: 100, id: 'root', startedAt: 1000 }),
      buildSpan({ id: 'child', parentSpanId: 'root', startedAt: 1010 }),
      buildSpan({
        id: 'grandchild',
        parentSpanId: 'child',
        startedAt: 1020
      }),
      buildSpan({ id: 'sibling', parentSpanId: 'root', startedAt: 1030 })
    ])

    const visible = visibleRows(layout.rows, new Set(['child']))

    expect(visible.map((row) => row.span.id)).toEqual([
      'root',
      'child',
      'sibling'
    ])
  })

  it('hides collapsed branches independently of each other', () => {
    const layout = computeWaterfallLayout([
      buildSpan({ durationMs: 100, id: 'root', startedAt: 1000 }),
      buildSpan({ id: 'branch-a', parentSpanId: 'root', startedAt: 1010 }),
      buildSpan({ id: 'a-child', parentSpanId: 'branch-a', startedAt: 1020 }),
      buildSpan({ id: 'branch-b', parentSpanId: 'root', startedAt: 1030 }),
      buildSpan({ id: 'b-child', parentSpanId: 'branch-b', startedAt: 1040 }),
      buildSpan({
        id: 'b-grandchild',
        parentSpanId: 'b-child',
        startedAt: 1050
      })
    ])

    const visible = visibleRows(layout.rows, new Set(['branch-a', 'b-child']))

    expect(visible.map((row) => row.span.id)).toEqual([
      'root',
      'branch-a',
      'branch-b',
      'b-child'
    ])
  })

  it('keeps a branch hidden when a collapsed row sits inside it', () => {
    const layout = computeWaterfallLayout([
      buildSpan({ durationMs: 100, id: 'root', startedAt: 1000 }),
      buildSpan({ id: 'child', parentSpanId: 'root', startedAt: 1010 }),
      buildSpan({
        id: 'grandchild',
        parentSpanId: 'child',
        startedAt: 1020
      }),
      buildSpan({ id: 'sibling', parentSpanId: 'root', startedAt: 1030 })
    ])

    const visible = visibleRows(layout.rows, new Set(['root', 'child']))

    expect(visible.map((row) => row.span.id)).toEqual(['root'])
  })

  it('hides the children of a collapsed span that was re-parented as a root', () => {
    const layout = computeWaterfallLayout([
      buildSpan({
        durationMs: 50,
        id: 'orphan',
        parentSpanId: 'not-ingested',
        startedAt: 1000
      }),
      buildSpan({
        id: 'orphan-child',
        parentSpanId: 'orphan',
        startedAt: 1010
      }),
      buildSpan({ id: 'other-root', startedAt: 1100 })
    ])

    const visible = visibleRows(layout.rows, new Set(['orphan']))

    expect(visible.map((row) => row.span.id)).toEqual(['orphan', 'other-root'])
  })
})
