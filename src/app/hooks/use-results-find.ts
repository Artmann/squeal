// Find-in-results, the session half: what the user typed, which match they are
// on, and whether non-matching rows are hidden.
//
// The state is local rather than in Redux. `ResultsPane` is mounted for as long
// as a workspace is shown, so the `mod+f` registered here already fires from
// anywhere in the app -- including out of CodeMirror, which is the usual reason
// to reach for a store -- and nothing outside this pane reads any of it.
import {
  RefObject,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

import type { QueryResultDto } from '@/glue/api/schemas'

import { getResultFieldNames } from '../components/query-result-columns'
import {
  buildResultSearchIndex,
  type ResultSearchView
} from '../components/query-result-search'
import { useAppSelector } from '../store'
import { selectOpenWorksheetIds } from '../store/tabs-slice'

interface FindSession {
  // An ordinal into the match list. Stored rather than clamped so that a
  // re-run which returns fewer rows does not lose the user's place, and read
  // through a clamp so it can never point past the end.
  activeIndex: number
  isFiltering: boolean
  isOpen: boolean
  // What the user typed, untrimmed: this is the input's value.
  query: string
}

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

const closedSession: FindSession = {
  activeIndex: 0,
  isFiltering: false,
  isOpen: false,
  query: ''
}

const noRows: Record<string, unknown>[] = []

export function useResultsFind({
  result,
  worksheetId,
  onShowResults
}: ResultsFindOptions): ResultsFind {
  const openWorksheetIds = useAppSelector(selectOpenWorksheetIds)

  // Kept per worksheet, like the pane's height and its active tab: coming back
  // to a tab should find it as it was left. Bounded by the open tabs rather
  // than by every worksheet visited this session.
  const [sessionByWorksheet, setSessionByWorksheet] = useState<
    Record<string, FindSession>
  >({})

  useEffect(() => {
    const open = new Set(openWorksheetIds)

    setSessionByWorksheet((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([id]) => open.has(id))
      )

      return Object.keys(next).length === Object.keys(current).length
        ? current
        : next
    })
  }, [openWorksheetIds])

  const session =
    (worksheetId ? sessionByWorksheet[worksheetId] : undefined) ?? closedSession

  const inputRef = useRef<HTMLInputElement>(null)

  // A counter rather than a boolean, so a second ⌘F while the bar is already
  // open still asks for focus. That is what makes ⌘F ⌘V with a different id
  // replace the old one instead of appending to it.
  const [focusRequest, setFocusRequest] = useState(0)

  useEffect(() => {
    if (focusRequest === 0) {
      return
    }

    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusRequest])

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

  // Clamped on read: a re-run, a narrowed query or a shorter result all shrink
  // the list, and doing this in an effect would cost a second render pass to
  // fix state that was only ever wrong in between.
  const activeIndex =
    matchCount === 0 ? -1 : Math.min(session.activeIndex, matchCount - 1)

  const updateSession = useCallback(
    (update: (session: FindSession) => FindSession) => {
      if (!worksheetId) {
        return
      }

      setSessionByWorksheet((current) => ({
        ...current,
        [worksheetId]: update(current[worksheetId] ?? closedSession)
      }))
    },
    [worksheetId]
  )

  const open = useCallback(() => {
    // Nothing to search means nothing to open: during a run or after a failure
    // there is no result behind the pane at all.
    if (!worksheetId || !result) {
      return
    }

    onShowResults()
    updateSession((current) => ({ ...current, isOpen: true }))
    setFocusRequest((count) => count + 1)
  }, [onShowResults, result, updateSession, worksheetId])

  const close = useCallback(() => {
    // The query survives a close, the way a browser's does. Only `isOpen` goes,
    // which is also what lifts the filter off the grid.
    updateSession((current) => ({ ...current, isOpen: false }))
  }, [updateSession])

  const setQuery = useCallback(
    (query: string) => {
      // Back to the first match on every edit, like Chrome. Letting the ordinal
      // survive a query change would leave the user on "match 4" of a set that
      // no longer has anything to do with the one they were walking.
      updateSession((current) => ({ ...current, activeIndex: 0, query }))
    },
    [updateSession]
  )

  const step = useCallback(
    (delta: number) => {
      if (matchCount === 0) {
        return
      }

      updateSession((current) => {
        const from = Math.min(current.activeIndex, matchCount - 1)

        return {
          ...current,
          activeIndex: (from + delta + matchCount) % matchCount
        }
      })
    },
    [matchCount, updateSession]
  )

  const next = useCallback(() => step(1), [step])
  const previous = useCallback(() => step(-1), [step])

  const toggleFiltering = useCallback(() => {
    updateSession((current) => ({
      ...current,
      isFiltering: !current.isFiltering
    }))
  }, [updateSession])

  // `EditorScreen` renders over a still-mounted workspace and the trace
  // dashboard mounts outside it, so without this ⌘F would open a find bar
  // behind whichever one is up and pull focus out of it.
  const isOverlayOpen = useAppSelector(
    (state) =>
      state.ui.editorScreen !== undefined ||
      state.ui.traceDashboardOpen === true
  )
  const isOverlayOpenRef = useRef(isOverlayOpen)

  useEffect(() => {
    isOverlayOpenRef.current = isOverlayOpen
  }, [isOverlayOpen])

  useHotkeys('mod+f', open, {
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
      inputRef,
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
