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
type Spans = ComponentProps<typeof TraceWaterfall>['spans']
type Traces = ComponentProps<typeof TraceList>['traces']
type Trace = Traces[number]

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

  const [selectedSpanId, setSelectedSpanId] = useState<string | undefined>()
  const [selectedTraceId, setSelectedTraceId] = useState<string | undefined>()

  const handleClose = useCallback(() => {
    dispatch(uiActions.closeTraceDashboard())
  }, [dispatch])

  const handleBack = useCallback(() => {
    setSelectedSpanId(undefined)
    setSelectedTraceId(undefined)
  }, [])

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

  return {
    handleBack,
    handleClose,
    selectedSpanId,
    selectedTraceId,
    setSelectedSpanId,
    setSelectedTraceId
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

function TraceSpansPanel({
  onSelectSpan,
  selectedSpanId,
  traceSpans
}: {
  // Takes undefined as well: the waterfall calls it with undefined to clear
  // the selection when the already-selected row is clicked again.
  onSelectSpan: (spanId: string | undefined) => void
  selectedSpanId: string | undefined
  traceSpans: UseQueryResult<Spans>
}): ReactElement {
  if (traceSpans.isPending) {
    return <LoadingState label="Loading trace" />
  }

  if (traceSpans.isError) {
    return (
      <ErrorState
        message="Could not load this trace."
        onRetry={() => void traceSpans.refetch()}
      />
    )
  }

  return (
    <TraceWaterfall
      onSelectSpan={onSelectSpan}
      spans={traceSpans.data}
      {...(selectedSpanId ? { selectedSpanId } : {})}
    />
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

  const {
    handleBack,
    handleClose,
    selectedSpanId,
    selectedTraceId,
    setSelectedSpanId,
    setSelectedTraceId
  } = useTraceSelection()

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

  const selectedSpan = traceSpans.data?.find(
    (span) => span.id === selectedSpanId
  )
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
        {selectedTraceId ? (
          <>
            <div className="flex-1 overflow-auto p-6">
              <TraceSpansPanel
                onSelectSpan={setSelectedSpanId}
                selectedSpanId={selectedSpanId}
                traceSpans={traceSpans}
              />
            </div>

            {selectedSpan ? <SpanDetailPanel span={selectedSpan} /> : null}
          </>
        ) : (
          <div className="flex-1 overflow-auto">
            <TraceListPanel
              hasActiveFilters={errorOnly || search !== ''}
              onSelect={setSelectedTraceId}
              traces={traces}
            />
          </div>
        )}
      </div>
    </div>
  )
}
