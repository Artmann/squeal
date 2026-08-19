import {
  lazy,
  ReactElement,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react'
import { toast } from 'sonner'
import invariant from 'tiny-invariant'

import { AppSidebar } from './components/AppSidebar'
import { EditorScreen } from './components/EditorScreen'
import { GettingStartedScreen } from './components/GettingStartedScreen'
import { ResultsPane } from './components/ResultsPane'
import { StatusBar } from './components/StatusBar'
import { TitleBar } from './components/TitleBar'
import type { CursorPosition } from './components/worksheet-editor-cursor'
import { WorksheetTabs } from './components/WorksheetTabs'
import { WorksheetToolbar } from './components/WorksheetToolbar'
import {
  useDatabases,
  useQueriesList,
  useQueryResultSync,
  useWorksheets
} from './hooks/queries'
import { useCancelQuery } from './hooks/mutations'
import { useStartQuery } from './hooks/use-start-query'
import { useWorksheetAutosave } from './hooks/useWorksheetAutosave'
import { isConnectionUnreadable, type DatabaseDto } from '@/glue/databases'
import { secretStorageMessages } from '@/glue/secret-storage'
import { useAppDispatch, useAppSelector } from './store'
import { selectActiveWorksheetId } from './store/tabs-slice'
import { uiActions } from './store/ui-slice'
import { createAstFromSql, type Statement } from './sql-parser'
import { findActiveStatementIndex } from './sql-parser/active-statement'
import {
  resolveEditorContent,
  type EditedContent
} from './worksheet-editor-content'

const WorksheetEditor = lazy(() =>
  import('./components/WorksheetEditor').then((module) => ({
    default: module.WorksheetEditor
  }))
)

function useActiveStatement(openWorksheetId: string | undefined) {
  const worksheets = useWorksheets()

  // The character offset drives statement detection; the status bar's line and
  // column are reported separately so neither has to derive the other.
  const [cursorOffset, setCursorOffset] = useState<number>(0)

  // What the editor holds, which is ahead of the saved copy for as long as the
  // autosave debounce is open. The cursor offset below is already live, so
  // parsing the saved copy would also mean matching a fresh offset against a
  // stale statement list.
  const [editedContent, setEditedContent] = useState<EditedContent | null>(null)

  const currentWorksheet = useMemo(
    () => worksheets.data.find((worksheet) => worksheet.id === openWorksheetId),
    [worksheets.data, openWorksheetId]
  )

  const content = resolveEditorContent(
    editedContent,
    openWorksheetId,
    currentWorksheet
  )

  const recordEditedContent = useCallback(
    (newContent: string) => {
      invariant(openWorksheetId, 'No worksheet is open')

      setEditedContent({ content: newContent, worksheetId: openWorksheetId })
    },
    [openWorksheetId]
  )

  const statements = useMemo(() => {
    if (!content) {
      return []
    }

    return createAstFromSql(content).statements
  }, [content])

  const activeStatementIndex = useMemo(
    () => findActiveStatementIndex(statements, cursorOffset),
    [statements, cursorOffset]
  )

  const activeStatement =
    activeStatementIndex === null ? null : statements[activeStatementIndex]

  return {
    activeStatement,
    activeStatementIndex,
    content,
    currentWorksheet,
    recordEditedContent,
    setCursorOffset,
    statements
  }
}

function useLatestQuery(openWorksheetId: string | undefined) {
  const queries = useQueriesList()

  return useMemo(() => {
    const sorted = queries.data
      .filter((q) => q.worksheetId === openWorksheetId)
      .sort((a, b) => b.queriedAt - a.queriedAt)

    return sorted[0]
  }, [queries.data, openWorksheetId])
}

function useRunQuery(
  activeStatement: Statement | null,
  database: DatabaseDto | undefined,
  databaseId: string | null | undefined,
  worksheetId: string | undefined,
  flushSave: () => void
) {
  const startQuery = useStartQuery()

  return useCallback(() => {
    if (!activeStatement) {
      console.error('No active statement')

      return
    }

    // Refused here rather than left to fail: the run would be accepted, the row
    // written, and the reason would only surface once the background fiber tried
    // to open a connection it has no password for.
    //
    // `databaseId` is kept as its own argument because a worksheet can point at
    // a database that no longer exists — then there is no DTO to check, and the
    // backend is the one that says so.
    if (database !== undefined && isConnectionUnreadable(database)) {
      toast.error("Can't run this query", {
        description: secretStorageMessages.cannotRunUnreadableConnection(
          database.name
        )
      })

      return
    }

    // Running is a good moment to stop waiting out the debounce: the statement
    // is already taken from the editor, so this only makes the saved copy match
    // what just ran. Nothing waits on it — the query carries its own SQL.
    flushSave()

    startQuery({ content: activeStatement.text, databaseId, worksheetId })
  }, [
    activeStatement,
    database,
    databaseId,
    flushSave,
    startQuery,
    worksheetId
  ])
}

/**
 * Everything the shell needs about the active worksheet: its statements, its
 * latest query, and the handlers that act on both. Bundled here so `App` itself
 * stays a layout.
 */
export function useWorksheetSession(openWorksheetId: string | undefined) {
  const databases = useDatabases()

  const {
    activeStatement,
    activeStatementIndex,
    content,
    currentWorksheet,
    recordEditedContent,
    setCursorOffset,
    statements
  } = useActiveStatement(openWorksheetId)

  const query = useLatestQuery(openWorksheetId)

  useQueryResultSync(query)

  const { cancel: handleCancelQuery, isCanceling } = useCancelQuery(query)

  const { flushSave, queueSave, saveState } =
    useWorksheetAutosave(openWorksheetId)

  const handleUpdateContent = useCallback(
    (newContent: string) => {
      // The parse follows the editor immediately; the save is what gets to
      // wait for the debounce.
      recordEditedContent(newContent)
      queueSave(newContent)
    },
    [queueSave, recordEditedContent]
  )

  const currentDatabase = useMemo(
    () =>
      databases.data.find(
        (database) => database.id === currentWorksheet?.databaseId
      ),
    [databases.data, currentWorksheet?.databaseId]
  )

  const handleRunQuery = useRunQuery(
    activeStatement,
    currentDatabase,
    currentWorksheet?.databaseId,
    openWorksheetId,
    flushSave
  )

  return {
    activeStatement,
    activeStatementIndex,
    content,
    currentDatabase,
    currentWorksheet,
    handleCancelQuery,
    handleRunQuery,
    handleUpdateContent,
    isCanceling,
    isQueryRunning: Boolean(query && !query.finishedAt),
    query,
    saveState,
    setCursorOffset,
    statements
  }
}

export function App(): ReactElement {
  const dispatch = useAppDispatch()
  const editorScreen = useAppSelector((state) => state.ui.editorScreen)
  const gettingStartedDismissed = useAppSelector(
    (state) => state.ui.gettingStartedDismissed
  )

  // Read here rather than taken from the worksheet session, so the choice of
  // screen is made before anything the workspace needs is set up. The
  // collections are already hydrated by AppShell, so this is a cache read.
  const databases = useDatabases()

  // Dismissible so an empty app is not a dead end. Saving a connection hides it
  // for good, and the sidebar's add button reaches the same form afterwards.
  const showGettingStartedScreen =
    databases.data.length === 0 && !gettingStartedDismissed

  // The first-run screen owns the slot, so an editor screen that was already
  // open when it took over has nowhere to render — deleting the last connection
  // while its "Add database" form is up gets there. Dropped rather than parked,
  // because otherwise it pops unasked the moment the screen is left.
  useEffect(() => {
    if (showGettingStartedScreen && editorScreen) {
      dispatch(uiActions.closeEditorScreen())
    }
  }, [dispatch, editorScreen, showGettingStartedScreen])

  return (
    <main className="w-full h-screen flex flex-col bg-panel2 overflow-hidden text-sm">
      {/* Mounted once, above the slot, and nothing the slot holds can cover it:
          the window is frameless, so this is the only drag region and the only
          minimize, maximize and close buttons Windows and Linux get. Not an
          app-wide promise — the trace dashboard mounts outside App entirely and
          does overlap the bottom of these buttons. */}
      <TitleBar />

      <div className="relative flex-1 min-h-0 flex flex-col">
        {showGettingStartedScreen ? (
          <GettingStartedScreen />
        ) : (
          <>
            <Workspace />

            {editorScreen && <EditorScreen {...editorScreen} />}
          </>
        )}
      </div>
    </main>
  )
}

function NoWorksheetOpen(): ReactElement {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-[6px] text-center">
      <p className="text-[13px] font-medium text-text2">No worksheet open</p>

      <p className="text-[12px] text-text3">
        Create a worksheet or pick one from the sidebar.
      </p>
    </div>
  )
}

/**
 * The app itself: sidebar, tabs, editor, results and status bar. Kept out of
 * `App` so it — and every hook and poller it owns — only mounts once the user
 * is past the first-run screen, rather than running behind it.
 */
function Workspace(): ReactElement {
  const openWorksheetId = useAppSelector(selectActiveWorksheetId)

  const [cursorPosition, setCursorPosition] = useState<CursorPosition>()

  const {
    activeStatement,
    activeStatementIndex,
    content,
    currentDatabase,
    currentWorksheet,
    handleCancelQuery,
    handleRunQuery,
    handleUpdateContent,
    isCanceling,
    isQueryRunning,
    query,
    saveState,
    setCursorOffset,
    statements
  } = useWorksheetSession(openWorksheetId)

  return (
    <div className="flex-1 min-h-0 flex">
      <AppSidebar />

      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        <WorksheetTabs />

        <WorksheetToolbar
          activeStatement={activeStatement}
          isCanceling={isCanceling}
          isQueryRunning={isQueryRunning}
          onCancelQuery={handleCancelQuery}
          onRunQuery={handleRunQuery}
        />

        <div className="flex-1 min-h-0 bg-panel">
          {currentWorksheet ? (
            <Suspense fallback={null}>
              <WorksheetEditor
                activeStatementIndex={activeStatementIndex}
                content={content}
                databaseType={currentDatabase?.type}
                statements={statements}
                onChange={handleUpdateContent}
                onCursorChange={setCursorPosition}
                onCursorPositionChange={setCursorOffset}
                onRunQuery={handleRunQuery}
              />
            </Suspense>
          ) : (
            <NoWorksheetOpen />
          )}
        </div>

        <ResultsPane
          databaseName={currentDatabase?.name}
          isQueryRunning={isQueryRunning}
          query={query}
          worksheetId={openWorksheetId}
        />

        <StatusBar
          cursorPosition={cursorPosition}
          database={currentDatabase}
          query={query}
          saveState={saveState}
        />
      </div>
    </div>
  )
}
