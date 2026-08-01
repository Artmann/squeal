import { ReactElement } from 'react'

import { cn } from '@/app/lib/utils'
import type { SpanDto } from '@/glue/api/schemas'

import { Separator } from '../ui/separator'
import { formatDuration } from './format-duration'

interface SpanDetailPanelProps {
  span: SpanDto
}

function AttributeTable({
  attributes
}: {
  attributes: Record<string, boolean | number | string>
}): ReactElement {
  return (
    <dl className="flex flex-col gap-1">
      {Object.entries(attributes).map(([key, value]) => (
        <div
          className="flex flex-col"
          key={key}
        >
          <dt className="text-text2">{key}</dt>
          <dd className="break-all font-mono">{String(value)}</dd>
        </div>
      ))}
    </dl>
  )
}

export function SpanDetailPanel({ span }: SpanDetailPanelProps): ReactElement {
  return (
    <aside className="flex w-96 shrink-0 flex-col overflow-y-auto border-l border-border bg-panel2 p-5 text-xs">
      <h2 className="truncate font-mono text-sm font-semibold">{span.name}</h2>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'rounded-full px-2 py-0.5',
            span.status === 'error' ? 'bg-err/20 text-err' : 'bg-ok/20 text-ok'
          )}
        >
          {span.status}
        </span>
        <span className="rounded-full bg-hover px-2 py-0.5">{span.kind}</span>
        <span className="rounded-full bg-hover px-2 py-0.5">
          {span.serviceName}
        </span>
        <span className="font-mono text-text2">
          {formatDuration(span.durationMs)}
        </span>
      </div>

      {span.statusMessage ? (
        <p className="mt-2 text-err">{span.statusMessage}</p>
      ) : null}

      {Object.keys(span.attributes).length > 0 ? (
        <>
          <Separator className="my-3" />

          <h3 className="mb-2 font-semibold text-text2">Attributes</h3>
          <AttributeTable attributes={span.attributes} />
        </>
      ) : null}

      {span.events.length > 0 ? (
        <>
          <Separator className="my-3" />

          <h3 className="mb-2 font-semibold text-text2">Events</h3>

          <div className="flex flex-col gap-3">
            {span.events.map((event, index) => (
              <div
                className="flex flex-col gap-1"
                key={index}
              >
                <span className="font-mono font-semibold">{event.name}</span>

                {event.attributes ? (
                  <div className="flex flex-col gap-1">
                    {Object.entries(event.attributes).map(([key, value]) =>
                      key === 'exception.stacktrace' ? (
                        <pre
                          className="overflow-x-auto rounded-sm bg-bg p-2 font-mono text-[10px] leading-relaxed"
                          key={key}
                        >
                          {String(value)}
                        </pre>
                      ) : (
                        <div
                          className="flex flex-col"
                          key={key}
                        >
                          <span className="text-text2">{key}</span>
                          <span className="break-all font-mono">
                            {String(value)}
                          </span>
                        </div>
                      )
                    )}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </aside>
  )
}
