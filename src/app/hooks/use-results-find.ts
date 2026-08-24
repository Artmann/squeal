// Find-in-results, the session half: what the user typed, which match they are
// on, and whether non-matching rows are hidden.
//
// The state is local rather than in Redux. `ResultsPane` is mounted for as long
// as a workspace is shown, so the `mod+f` registered here already fires from
// anywhere in the app -- including out of CodeMirror, which is the usual reason
// to reach for a store -- and nothing outside this pane reads any of it.
//
// The session's own moves live in `../find-session`, as plain functions over a
// plain value; what is left here is React and the shortcut.
import {
  RefObject,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef
} from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

import type { QueryResultDto } from '@/glue/api/schemas'

import { getResultFieldNames } from '../components/query-result-columns'
import {
  buildResultSearchIndex,
  type ResultSearchView
} from '../components/query-result-search'
import {
  activeIndexWithin,
  closed,
  closedSession,
  type FindSession,
  opened,
  stepped,
  withFilteringToggled,
  withQuery
} from '../find-session'
import { useAppSelector } from '../store'
import { useFocusRequest } from './use-focus-request'
import { usePerWorksheetState } from './use-per-worksheet-state'

export interface ResultsFind {
  // 1-based, for display. 0 when there is nothing to jump to.
  activeOrdinal: number
  close: () => void
  inputRef: RefObject<HTMLInputElement | null>
  isFiltering: boolean
  isOpen: boolean
  matchCount: number
  next: () => void
  open: () => void
  previous: () => void
  query: string
  rowCount: number
  search: ResultSearchView | undefined
  setQuery: (query: string) => void
  toggleFiltering: () => void
  truncated: boolean
}

interface ResultsFindOptions {
  result: QueryResultDto | null | undefined
  worksheetId: string | undefined
  // Find is find-in-results, so opening it while the Messages tab is showing
  // has to bring the results back or the shortcut looks broken.
  onShowResults: () => void
}

const noRows: Record<string, unknown>[] = []

export function useResultsFind({
  result,
  worksheetId,
  onShowResults
}: ResultsFindOptions): ResultsFind {
  // Kept per worksheet, like the pane's height and its active tab: coming back
  // to a tab should find it as it was left.
  const sessions = usePerWorksheetState(closedSession)
  const session = sessions.valueFor(worksheetId)

  const focus = useFocusRequest<HTMLInputElement>()

  // Scanning every row is cheap enough not to need a debounce, but it is not
  // free on a full result of JSON columns. Deferring the needle keeps the input
  // itself immediate and lets the scan and the grid repaint at a priority React
  // can interrupt.
  const deferredQuery = useDeferredValue(session.query)

  const columnNames = useMemo(
    () => (result ? getResultFieldNames(result) : []),
    [result]
  )

  const index = useMemo(
    () =>
      buildResultSearchIndex({
        columnNames,
        query: session.isOpen ? deferredQuery : '',
        rows: result?.rows ?? noRows
      }),
    [columnNames, deferredQuery, result, session.isOpen]
  )

  const matchCount = index.matches.length
  const activeIndex = activeIndexWithin(session, matchCount)

  const update = useCallback(
    (move: (session: FindSession) => FindSession) =>
      sessions.update(worksheetId, move),
    [sessions, worksheetId]
  )

  const open = useCallback(() => {
    // Nothing to search means nothing to open: during a run or after a failure
    // there is no result behind the pane at all.
    if (!result) {
      return
    }

    onShowResults()
    update(opened)
    focus.request()
  }, [focus, onShowResults, result, update])

  const close = useCallback(() => update(closed), [update])

  const setQuery = useCallback(
    (query: string) => update((current) => withQuery(current, query)),
    [update]
  )

  const next = useCallback(
    () => update((current) => stepped(current, { delta: 1, matchCount })),
    [matchCount, update]
  )

  const previous = useCallback(
    () => update((current) => stepped(current, { delta: -1, matchCount })),
    [matchCount, update]
  )

  const toggleFiltering = useCallback(
    () => update(withFilteringToggled),
    [update]
  )

  useFindHotkey(open)

  const search = useMemo(
    () =>
      session.isOpen
        ? {
            activeIndex,
            columnHasMatch: index.columnHasMatch,
            isFiltering: session.isFiltering,
            matches: index.matches,
            needle: index.needle,
            query: session.query
          }
        : undefined,
    [activeIndex, index, session.isFiltering, session.isOpen, session.query]
  )

  return useMemo(
    () => ({
      activeOrdinal: activeIndex + 1,
      close,
      inputRef: focus.ref,
      isFiltering: session.isFiltering,
      isOpen: session.isOpen,
      matchCount,
      next,
      open,
      previous,
      query: session.query,
      rowCount: result?.rows.length ?? 0,
      search,
      setQuery,
      toggleFiltering,
      truncated: result?.truncated === true
    }),
    [
      activeIndex,
      close,
      focus.ref,
      matchCount,
      next,
      open,
      previous,
      result,
      search,
      session.isFiltering,
      session.isOpen,
      session.query,
      setQuery,
      toggleFiltering
    ]
  )
}

/**
 * `mod+f`, wherever focus happens to be.
 *
 * Held apart from the session because everything interesting about it is the
 * registration rather than the handler.
 */
function useFindHotkey(onOpen: () => void): void {
  // `EditorScreen` renders over a still-mounted workspace and the trace
  // dashboard mounts outside it, so without this ⌘F would open a find bar
  // behind whichever one is up and pull focus out of it.
  const isOverlayOpen = useAppSelector(
    (state) =>
      state.ui.editorScreen !== undefined ||
      state.ui.traceDashboardOpen === true
  )

  // Read through a ref because `ignoreEventWhen` is called from the library's
  // own listener rather than during render: a closure over the render value
  // would either go stale or force a re-registration on every render,
  // depending on how the options are memoized. A ref is right either way.
  const isOverlayOpenRef = useRef(isOverlayOpen)

  useEffect(() => {
    isOverlayOpenRef.current = isOverlayOpen
  }, [isOverlayOpen])

  useHotkeys('mod+f', onOpen, {
    // CodeMirror is a contenteditable and holds focus by default, so without
    // this the shortcut is dead exactly where it is most wanted: straight after
    // a query returns.
    enableOnContentEditable: true,
    enableOnFormTags: true,
    // Not `enabled`: a hotkey that matches while disabled gets
    // stopImmediatePropagation() called on its event, which would swallow ⌘F
    // for everyone else rather than declining it.
    ignoreEventWhen: () => isOverlayOpenRef.current,
    preventDefault: true
  })
}
