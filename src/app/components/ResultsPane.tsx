import { SearchIcon } from 'lucide-react'
import { ReactElement, useCallback } from 'react'

import type { QueryDto } from '@/glue/api/schemas'
import { isQueryFinished } from '@/glue/queries'

import { getFindShortcut } from '../find-shortcut'
import { usePerWorksheetState } from '../hooks/use-per-worksheet-state'
import { usePersistedSizes } from '../hooks/use-persisted-sizes'
import { useResultsFind } from '../hooks/use-results-find'
import { useWorksheetMessages } from '../hooks/use-worksheet-messages'
import { cn } from '../lib/utils'
import { QueryMessages } from './QueryMessages'
import { QueryResultContent } from './QueryResultContent'
import { ResizeHandle } from './ResizeHandle'
import { ResultsFindBar } from './ResultsFindBar'
import { TimeAgo } from './TimeAgo'

type ResultsTab = 'messages' | 'results'

const defaultTab: ResultsTab = 'results'

const defaultHeight = 320
const maximumHeight = 620
const minimumHeight = 120

// Enough that a session's worth of worksheets all keep their height, small
// enough that the stored record cannot grow without end.
const maximumRememberedHeights = 50

interface ResultsPaneProps {
  databaseName: string | undefined
  query: QueryDto | undefined
  worksheetId: string | undefined
}

function formatRowCount(result: {
  rowCount: number
  truncated: boolean
}): string {
  const count = Intl.NumberFormat().format(result.rowCount)
  const suffix = result.truncated ? '+' : ''
  const noun = result.rowCount === 1 ? 'row' : 'rows'

  return `${count}${suffix} ${noun}`
}

export function ResultsPane({
  databaseName,
  query,
  worksheetId
}: ResultsPaneProps): ReactElement {
  const messages = useWorksheetMessages(worksheetId)

  // Each worksheet keeps its own height, and the record is bounded by a cap on
  // how many it holds rather than by the open tabs: closing a worksheet and
  // opening it again is ordinary, and losing its height there would make this
  // hold only for as long as the tab does.
  const { setSize, sizeFor } = usePersistedSizes({
    defaultSize: defaultHeight,
    maximum: maximumHeight,
    maximumKeys: maximumRememberedHeights,
    minimum: minimumHeight,
    storageKey: 'ui:resultsHeight'
  })

  const height = sizeFor(worksheetId)

  // Which tab is showing is remembered per worksheet, so switching tabs does
  // not snap everyone back to Results.
  const tabs = usePerWorksheetState<ResultsTab>(defaultTab)

  const activeTab = tabs.valueFor(worksheetId)

  const selectTab = useCallback(
    (tab: ResultsTab) => {
      tabs.update(worksheetId, () => tab)
    },
    [tabs, worksheetId]
  )

  const showResults = useCallback(() => selectTab('results'), [selectTab])

  const find = useResultsFind({
    result: query?.result,
    worksheetId,
    onShowResults: showResults
  })

  const isFindShowing = find.isOpen && activeTab === 'results'

  return (
    <>
      {/* With no worksheet open there is no key to store the height under, so
          the drag moves the fallback — which is the height every worksheet
          nobody has resized starts at, and what a single shared height did for
          all of them. */}
      <ResizeHandle
        ariaLabel="Resize results panel"
        className="h-[7px] -my-[3px]"
        growsToward="start"
        orientation="row"
        size={height}
        onResize={(size) => setSize(worksheetId, size)}
      />

      <section
        className="flex flex-none flex-col border-t border-border bg-panel"
        style={{ height: `${height}px` }}
      >
        <div className="flex h-[37px] flex-none items-center gap-[2px] border-b border-border2 bg-panel2 px-2">
          <div
            className="flex items-center gap-[2px]"
            role="tablist"
          >
            <ResultsTabButton
              isActive={activeTab === 'results'}
              label="Results"
              onSelect={() => selectTab('results')}
            />

            <ResultsTabButton
              isActive={activeTab === 'messages'}
              label="Messages"
              onSelect={() => selectTab('messages')}
            />
          </div>

          {/* The find affordance and the run summary are one right-aligned
              group. An `ml-auto` on each instead splits the free space between
              them, which left the search icon stranded mid-strip rather than
              sitting where its input is about to appear. */}
          <div className="ml-auto flex flex-none items-center gap-[2px]">
            {isFindShowing ? (
              <ResultsFindBar find={find} />
            ) : (
              query?.result && (
                <button
                  aria-label="Find in results"
                  className="flex size-[22px] flex-none items-center justify-center rounded-[5px] text-text2 hover:bg-hover"
                  title={`Find in results (${getFindShortcut()})`}
                  type="button"
                  onClick={find.open}
                >
                  <SearchIcon className="size-3" />
                </button>
              )
            )}

            <div
              className={cn(
                'pl-[10px] font-mono text-[11.5px] whitespace-nowrap text-text3',
                // In a 37px strip the find bar wins; the same run summary is in
                // the status bar either way.
                isFindShowing && 'hidden lg:block'
              )}
            >
              <ResultsMeta query={query} />
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {activeTab === 'messages' ? (
            <QueryMessages messages={messages} />
          ) : (
            <QueryResultContent
              databaseName={databaseName}
              query={query}
              search={find.search}
            />
          )}
        </div>
      </section>
    </>
  )
}

function ResultsMeta({ query }: { query: QueryDto | undefined }): ReactElement {
  if (!isQueryFinished(query)) {
    return <></>
  }

  const durationMs = query.finishedAt - query.queriedAt

  if (query.error !== null) {
    return <>failed · {Intl.NumberFormat().format(durationMs)} ms</>
  }

  if (!query.result) {
    return <></>
  }

  return (
    <>
      {formatRowCount(query.result)} · {Intl.NumberFormat().format(durationMs)}{' '}
      ms · <TimeAgo timestamp={query.queriedAt} />
    </>
  )
}

function ResultsTabButton({
  isActive,
  label,
  onSelect
}: {
  isActive: boolean
  label: string
  onSelect: () => void
}): ReactElement {
  return (
    <button
      aria-selected={isActive}
      className={cn(
        'h-[25px] rounded-[5px] px-[10px] text-[12px] font-medium',
        isActive
          ? 'bg-[var(--sel)] text-text'
          : 'bg-transparent text-text3 hover:text-text'
      )}
      role="tab"
      type="button"
      onClick={onSelect}
    >
      {label}
    </button>
  )
}
