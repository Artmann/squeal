import type { SpanDto } from '@/glue/api/schemas'

const minBarWidthPercent = 0.5

export interface WaterfallLayout {
  rows: WaterfallRow[]
  totalDurationMs: number
}

export interface WaterfallRow {
  depth: number
  hasChildren: boolean
  leftPercent: number
  span: SpanDto
  widthPercent: number
}

export function computeWaterfallLayout(spans: SpanDto[]): WaterfallLayout {
  if (spans.length === 0) {
    return { rows: [], totalDurationMs: 0 }
  }

  const spanIds = new Set(spans.map((span) => span.id))
  const childrenByParent = new Map<string | null, SpanDto[]>()

  for (const span of spans) {
    // A span whose parent was never ingested (lost batch, trimmed trace)
    // still needs to render — treat it as a root.
    const parentKey =
      span.parentSpanId && spanIds.has(span.parentSpanId)
        ? span.parentSpanId
        : null

    const siblings = childrenByParent.get(parentKey) ?? []

    siblings.push(span)
    childrenByParent.set(parentKey, siblings)
  }

  for (const siblings of childrenByParent.values()) {
    siblings.sort((a, b) => a.startedAt - b.startedAt)
  }

  const traceStart = Math.min(...spans.map((span) => span.startedAt))
  const traceEnd = Math.max(
    ...spans.map((span) => span.startedAt + span.durationMs)
  )
  const totalDurationMs = Math.max(traceEnd - traceStart, 1)

  const rows: WaterfallRow[] = []

  const visit = (span: SpanDto, depth: number): void => {
    const children = childrenByParent.get(span.id) ?? []

    rows.push({
      depth,
      hasChildren: children.length > 0,
      leftPercent: ((span.startedAt - traceStart) / totalDurationMs) * 100,
      span,
      widthPercent: Math.max(
        (span.durationMs / totalDurationMs) * 100,
        minBarWidthPercent
      )
    })

    for (const child of children) {
      visit(child, depth + 1)
    }
  }

  for (const root of childrenByParent.get(null) ?? []) {
    visit(root, 0)
  }

  return { rows, totalDurationMs: traceEnd - traceStart }
}

export function visibleRows(
  rows: WaterfallRow[],
  collapsed: Set<string>
): WaterfallRow[] {
  const hidden = new Set<string>()
  const visible: WaterfallRow[] = []

  for (const row of rows) {
    if (row.span.parentSpanId && hidden.has(row.span.parentSpanId)) {
      hidden.add(row.span.id)

      continue
    }

    visible.push(row)

    if (collapsed.has(row.span.id)) {
      hidden.add(row.span.id)
    }
  }

  return visible
}
