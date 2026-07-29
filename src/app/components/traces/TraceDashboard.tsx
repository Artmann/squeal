import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeftIcon,
  CopyIcon,
  Loader2Icon,
  SearchIcon,
  XIcon
} from 'lucide-react'
import { ReactElement, ReactNode, useCallback, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { toast } from 'sonner'

import { apiClient } from '@/app/api-client'
import { queryKeys } from '@/app/query-keys'
import { useAppDispatch } from '@/app/store'
import { uiActions } from '@/app/store/ui-slice'

import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { formatDuration } from './format-duration'
import { SpanDetailPanel } from './SpanDetailPanel'
import { TraceList } from './TraceList'
import { TraceWaterfall } from './TraceWaterfall'

const dashboardRefetchIntervalMs = 2000

function CenteredState({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6">
      {children}
    </div>
  )
}

function LoadingState({ label }: { label: string }): ReactElement {
  return (
    <CenteredState>
      <Loader2Icon
        aria-label={label}
        className="size-6 animate-spin text-subtext-0"
        role="status"
      />
    </CenteredState>
  )
}

export function TraceDashboard(): ReactElement {
  const dispatch = useAppDispatch()

  const [errorOnly, setErrorOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedSpanId, setSelectedSpanId] = useState<string | undefined>()
  const [selectedTraceId, setSelectedTraceId] = useState<string | undefined>()

  const handleClose = useCallback(() => {
    dispatch(uiActions.closeTraceDashboard())
  }, [dispatch])

  const handleBack = useCallback(() => {
    setSelectedSpanId(undefined)
    setSelectedTraceId(undefined)
  }, [])

  // Escape steps back one level at a time instead of dropping the user all
  // the way out of the dashboard.
  const handleEscape = useCallback(() => {
    if (selectedSpanId) {
      setSelectedSpanId(undefined)

      return
    }

    if (selectedTraceId) {
      handleBack()

      return
    }

    handleClose()
  }, [handleBack, handleClose, selectedSpanId, selectedTraceId])

  useHotkeys('escape', handleEscape, { enableOnFormTags: true })

  const traces = useQuery({
    queryFn: () =>
      apiClient.getTraces({
        errorOnly,
        limit: 100,
        ...(search ? { search } : {})
      }),
    queryKey: queryKeys.traces({ errorOnly, search }),
    refetchInterval: dashboardRefetchIntervalMs
  })

  const traceSpans = useQuery({
    enabled: Boolean(selectedTraceId),
    queryFn: () => {
      if (!selectedTraceId) {
        throw new Error('Trace id is required')
      }

      return apiClient.getTraceSpans(selectedTraceId)
    },
    queryKey: queryKeys.traceSpans(selectedTraceId ?? ''),
    refetchInterval: dashboardRefetchIntervalMs
  })

  const handleCopyTraceId = useCallback(() => {
    if (!selectedTraceId) {
      return
    }

    void navigator.clipboard.writeText(selectedTraceId).then(() => {
      toast('Trace ID copied')
    })
  }, [selectedTraceId])

  const hasActiveFilters = errorOnly || search !== ''
  const selectedSpan = traceSpans.data?.find(
    (span) => span.id === selectedSpanId
  )
  const selectedTrace = traces.data?.find(
    (trace) => trace.traceId === selectedTraceId
  )

  return (
    <div className="fixed inset-x-0 bottom-0 top-7 z-100 flex flex-col bg-base">
      <header className="flex items-center gap-3 border-b border-surface-0 px-6 py-4">
        {selectedTraceId ? (
          <Button
            onClick={handleBack}
            size="icon-sm"
            variant="ghost"
          >
            <ArrowLeftIcon className="size-4" />
          </Button>
        ) : null}

        <h1 className="font-display text-lg font-semibold">
          {selectedTrace ? selectedTrace.name : 'Traces'}
        </h1>

        {selectedTrace ? (
          <span className="font-mono text-xs text-subtext-0">
            {formatDuration(selectedTrace.durationMs)}
          </span>
        ) : null}

        {selectedTraceId ? (
          <button
            className="flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-xs text-subtext-0 hover:bg-surface-0 hover:text-text"
            onClick={handleCopyTraceId}
            title="Copy trace ID"
            type="button"
          >
            {selectedTraceId.slice(0, 16)}…
            <CopyIcon className="size-3" />
          </button>
        ) : (
          <span className="flex items-center gap-1.5 rounded-full bg-surface-0 px-2 py-0.5 text-[11px] text-subtext-0">
            <span className="size-1.5 animate-pulse rounded-full bg-green" />
            Live
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {selectedTraceId ? null : (
            <>
              <Button
                aria-pressed={errorOnly}
                onClick={() => setErrorOnly((value) => !value)}
                size="sm"
                variant={errorOnly ? 'secondary' : 'outline'}
              >
                Errors only
              </Button>

              <div className="relative">
                <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtext-0" />

                <Input
                  className="h-8 w-56 pl-8"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search traces…"
                  value={search}
                />
              </div>
            </>
          )}

          <Button
            onClick={handleClose}
            size="icon-sm"
            variant="ghost"
          >
            <XIcon className="size-4" />
          </Button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {selectedTraceId ? (
          <>
            <div className="flex-1 overflow-auto p-6">
              {traceSpans.isPending ? (
                <LoadingState label="Loading trace" />
              ) : traceSpans.isError ? (
                <CenteredState>
                  <p className="text-sm text-subtext-0">
                    Could not load this trace.
                  </p>

                  <Button
                    onClick={() => void traceSpans.refetch()}
                    size="sm"
                    variant="outline"
                  >
                    Retry
                  </Button>
                </CenteredState>
              ) : (
                <TraceWaterfall
                  onSelectSpan={setSelectedSpanId}
                  spans={traceSpans.data}
                  {...(selectedSpanId ? { selectedSpanId } : {})}
                />
              )}
            </div>

            {selectedSpan ? <SpanDetailPanel span={selectedSpan} /> : null}
          </>
        ) : (
          <div className="flex-1 overflow-auto">
            {traces.isPending ? (
              <LoadingState label="Loading traces" />
            ) : traces.isError ? (
              <CenteredState>
                <p className="text-sm text-subtext-0">Could not load traces.</p>

                <Button
                  onClick={() => void traces.refetch()}
                  size="sm"
                  variant="outline"
                >
                  Retry
                </Button>
              </CenteredState>
            ) : traces.data.length === 0 ? (
              <CenteredState>
                <p className="text-center text-sm text-subtext-0">
                  {hasActiveFilters
                    ? 'No traces match your filters.'
                    : 'No traces yet. Use the app — run a query, for example — and its trace will show up here.'}
                </p>
              </CenteredState>
            ) : (
              <TraceList
                onSelect={setSelectedTraceId}
                traces={traces.data}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
