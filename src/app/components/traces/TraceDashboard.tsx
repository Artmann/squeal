import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import {
  ArrowLeftIcon,
  CopyIcon,
  Loader2Icon,
  SearchIcon,
  XIcon
} from 'lucide-react'
import {
  ComponentProps,
  ReactElement,
  ReactNode,
  useCallback,
  useEffect,
  useState
} from 'react'
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

// Derived from the child components rather than imported, so this file does not
// need to know where the DTOs live.
type Traces = ComponentProps<typeof TraceList>['traces']
type Trace = Traces[number]

/**
 * The three screens the dashboard has, stated once. A span is only selectable
 * inside a trace, and saying so here is what lets the spans query take a
 * definite id and lets the sidebar be produced from the same status branch as
 * the waterfall it belongs to.
 */
type TraceView =
  | { kind: 'list' }
  | { kind: 'span'; spanId: string; traceId: string }
  | { kind: 'spans'; traceId: string }

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
        className="size-6 animate-spin text-text2"
        role="status"
      />
    </CenteredState>
  )
}

function ErrorState({
  message,
  onRetry
}: {
  message: string
  onRetry: () => void
}): ReactElement {
  return (
    <CenteredState>
      <p className="text-sm text-text2">{message}</p>

      <Button
        onClick={onRetry}
        size="sm"
        variant="outline"
      >
        Retry
      </Button>
    </CenteredState>
  )
}

// Owns which trace and span are open, plus the escape behaviour that steps back
// one level at a time instead of dropping the user out of the dashboard.
function useTraceSelection() {
  const dispatch = useAppDispatch()

  const [view, setView] = useState<TraceView>({ kind: 'list' })

  const handleClose = useCallback(() => {
    dispatch(uiActions.closeTraceDashboard())
  }, [dispatch])

  const handleBack = useCallback(() => {
    setView({ kind: 'list' })
  }, [])

  const handleOpenTrace = useCallback((traceId: string) => {
    setView({ kind: 'spans', traceId })
  }, [])

  // Takes undefined as well: the waterfall clears the selection by calling it
  // with undefined when the already-selected row is clicked again.
  const handleSelectSpan = useCallback((spanId: string | undefined) => {
    setView((current) => {
      if (current.kind === 'list') {
        return current
      }

      if (spanId === undefined) {
        return { kind: 'spans', traceId: current.traceId }
      }

      return { kind: 'span', spanId, traceId: current.traceId }
    })
  }, [])

  const handleEscape = useCallback(() => {
    if (view.kind === 'span') {
      handleSelectSpan(undefined)

      return
    }

    if (view.kind === 'spans') {
      handleBack()

      return
    }

    handleClose()
  }, [handleBack, handleClose, handleSelectSpan, view.kind])

  useHotkeys('escape', handleEscape, { enableOnFormTags: true })

  return {
    handleBack,
    handleClose,
    handleOpenTrace,
    handleSelectSpan,
    view
  }
}

function TraceFilters({
  errorOnly,
  onErrorOnlyChange,
  onSearchChange,
  search
}: {
  errorOnly: boolean
  onErrorOnlyChange: (value: boolean) => void
  onSearchChange: (value: string) => void
  search: string
}): ReactElement {
  return (
    <>
      <Button
        aria-pressed={errorOnly}
        onClick={() => onErrorOnlyChange(!errorOnly)}
        size="sm"
        variant={errorOnly ? 'secondary' : 'outline'}
      >
        Errors only
      </Button>

      <div className="relative">
        <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text2" />

        <Input
          className="h-8 w-56 pl-8"
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search traces…"
          value={search}
        />
      </div>
    </>
  )
}

function TraceIdentity({
  selectedTraceId
}: {
  selectedTraceId: string | undefined
}): ReactElement {
  const handleCopyTraceId = useCallback(() => {
    if (!selectedTraceId) {
      return
    }

    void navigator.clipboard.writeText(selectedTraceId).then(() => {
      toast('Trace ID copied')
    })
  }, [selectedTraceId])

  if (!selectedTraceId) {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-hover px-2 py-0.5 text-[11px] text-text2">
        <span className="size-1.5 animate-pulse rounded-full bg-ok" />
        Live
      </span>
    )
  }

  return (
    <button
      className="flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-xs text-text2 hover:bg-hover hover:text-text"
      onClick={handleCopyTraceId}
      title="Copy trace ID"
      type="button"
    >
      {selectedTraceId.slice(0, 16)}…
      <CopyIcon className="size-3" />
    </button>
  )
}

function TraceDashboardHeader({
  errorOnly,
  onBack,
  onClose,
  onErrorOnlyChange,
  onSearchChange,
  search,
  selectedTrace,
  selectedTraceId
}: {
  errorOnly: boolean
  onBack: () => void
  onClose: () => void
  onErrorOnlyChange: (value: boolean) => void
  onSearchChange: (value: string) => void
  search: string
  selectedTrace: Trace | undefined
  selectedTraceId: string | undefined
}): ReactElement {
  return (
    <header className="flex items-center gap-3 border-b border-border px-6 py-4">
      {selectedTraceId ? (
        <Button
          onClick={onBack}
          size="icon-sm"
          variant="ghost"
        >
          <ArrowLeftIcon className="size-4" />
        </Button>
      ) : null}

      <h1 className="text-lg font-semibold">
        {selectedTrace ? selectedTrace.name : 'Traces'}
      </h1>

      {selectedTrace ? (
        <span className="font-mono text-xs text-text2">
          {formatDuration(selectedTrace.durationMs)}
        </span>
      ) : null}

      <TraceIdentity selectedTraceId={selectedTraceId} />

      <div className="ml-auto flex items-center gap-2">
        {selectedTraceId ? null : (
          <TraceFilters
            errorOnly={errorOnly}
            onErrorOnlyChange={onErrorOnlyChange}
            onSearchChange={onSearchChange}
            search={search}
          />
        )}

        <Button
          onClick={onClose}
          size="icon-sm"
          variant="ghost"
        >
          <XIcon className="size-4" />
        </Button>
      </div>
    </header>
  )
}

/**
 * Owns the spans of one trace: the query, the waterfall, and the detail sidebar
 * that reads the same rows. Keeping the sidebar in here is the point — it is
 * rendered from the success branch, so a failed poll cannot leave it standing
 * beside an error. TanStack Query keeps the last successful `data` through a
 * failed refetch, which is exactly how that used to happen.
 */
function TraceSpansPanel({
  onSelectSpan,
  selectedSpanId,
  traceId
}: {
  // Takes undefined as well: the waterfall calls it with undefined to clear
  // the selection when the already-selected row is clicked again.
  onSelectSpan: (spanId: string | undefined) => void
  selectedSpanId: string | undefined
  traceId: string
}): ReactElement {
  const traceSpans = useQuery({
    queryFn: () => apiClient.getTraceSpans(traceId),
    queryKey: queryKeys.traceSpans(traceId),
    refetchInterval: dashboardRefetchIntervalMs
  })

  // Only from a successful load: TanStack Query keeps the last `data` through a
  // failed refetch, and rendering the sidebar from rows the waterfall beside it
  // has already replaced with an error is the split screen this component was
  // taking apart.
  const spans = traceSpans.isSuccess ? traceSpans.data : undefined
  const selectedSpan = spans?.find((span) => span.id === selectedSpanId)

  // No span to show means no span is selected. Retention trimming the span and
  // a poll that failed both arrive here, and in both the id names something the
  // user cannot see — which the escape ladder would otherwise still step
  // through, spending its first press on nothing.
  useEffect(() => {
    if (selectedSpanId !== undefined && selectedSpan === undefined) {
      onSelectSpan(undefined)
    }
  }, [onSelectSpan, selectedSpan, selectedSpanId])

  // Each branch carries the same wrapper: it is what gives the panel its width
  // in the row, and `CenteredState` centres inside whatever it is given.
  if (traceSpans.isPending) {
    return (
      <div className="flex-1 overflow-auto p-6">
        <LoadingState label="Loading trace" />
      </div>
    )
  }

  if (traceSpans.isError) {
    return (
      <div className="flex-1 overflow-auto p-6">
        <ErrorState
          message="Could not load this trace."
          onRetry={() => void traceSpans.refetch()}
        />
      </div>
    )
  }

  return (
    <>
      <div className="flex-1 overflow-auto p-6">
        <TraceWaterfall
          onSelectSpan={onSelectSpan}
          selectedSpanId={selectedSpanId}
          spans={traceSpans.data}
        />
      </div>

      {selectedSpan ? <SpanDetailPanel span={selectedSpan} /> : null}
    </>
  )
}

function TraceListPanel({
  hasActiveFilters,
  onSelect,
  traces
}: {
  hasActiveFilters: boolean
  onSelect: (traceId: string) => void
  traces: UseQueryResult<Traces>
}): ReactElement {
  if (traces.isPending) {
    return <LoadingState label="Loading traces" />
  }

  if (traces.isError) {
    return (
      <ErrorState
        message="Could not load traces."
        onRetry={() => void traces.refetch()}
      />
    )
  }

  if (traces.data.length === 0) {
    return (
      <CenteredState>
        <p className="text-center text-sm text-text2">
          {hasActiveFilters
            ? 'No traces match your filters.'
            : 'No traces yet. Use the app — run a query, for example — and its trace will show up here.'}
        </p>
      </CenteredState>
    )
  }

  return (
    <TraceList
      onSelect={onSelect}
      traces={traces.data}
    />
  )
}

export function TraceDashboard(): ReactElement {
  const [errorOnly, setErrorOnly] = useState(false)
  const [search, setSearch] = useState('')

  const { handleBack, handleClose, handleOpenTrace, handleSelectSpan, view } =
    useTraceSelection()

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

  const selectedTraceId = view.kind === 'list' ? undefined : view.traceId

  // The traces list, not the spans query — the header keeps naming the trace
  // while its spans are still loading, or failing to.
  const selectedTrace = traces.data?.find(
    (trace) => trace.traceId === selectedTraceId
  )

  return (
    <div className="fixed inset-x-0 bottom-0 top-7 z-100 flex flex-col bg-panel">
      <TraceDashboardHeader
        errorOnly={errorOnly}
        onBack={handleBack}
        onClose={handleClose}
        onErrorOnlyChange={setErrorOnly}
        onSearchChange={setSearch}
        search={search}
        selectedTrace={selectedTrace}
        selectedTraceId={selectedTraceId}
      />

      <div className="flex flex-1 overflow-hidden">
        {view.kind === 'list' ? (
          <div className="flex-1 overflow-auto">
            <TraceListPanel
              hasActiveFilters={errorOnly || search !== ''}
              onSelect={handleOpenTrace}
              traces={traces}
            />
          </div>
        ) : (
          <TraceSpansPanel
            onSelectSpan={handleSelectSpan}
            selectedSpanId={view.kind === 'span' ? view.spanId : undefined}
            traceId={view.traceId}
          />
        )}
      </div>
    </div>
  )
}
