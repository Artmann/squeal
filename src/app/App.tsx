import {
  lazy,
  ReactElement,
  Suspense,
  useCallback,
  useMemo,
  useState
} from 'react'
import { toast } from 'sonner'
import { v7 } from 'uuid'

import { AppSidebar } from './components/AppSidebar'
import { EditorScreen } from './components/EditorScreen'
import { GettingStartedScreen } from './components/GettingStartedScreen'
import { ResultsPane } from './components/ResultsPane'
import { StatusBar } from './components/StatusBar'
import { TitleBar } from './components/TitleBar'
import type { CursorPosition } from './components/worksheet-editor-cursor'
import { WorksheetTabs } from './components/WorksheetTabs'
import { WorksheetToolbar } from './components/WorksheetToolbar'
import { useCollections } from './collections-context'
import {
  useDatabases,
  useQueriesList,
  useQueryResultSync,
  useWorksheets
} from './hooks/queries'
import { useCancelQuery } from './hooks/mutations'
import { useWorksheetAutosave } from './hooks/useWorksheetAutosave'
import type { QueryDto } from '@/glue/api/schemas'
import { useAppSelector } from './store'
import { selectActiveWorksheetId } from './store/tabs-slice'
import { finishQueryTrace, startQueryTrace } from './tracing/query-traces'
import { createAstFromSql, type Statement } from './sql-parser'
import { findActiveStatementIndex } from './sql-parser/active-statement'

const WorksheetEditor = lazy(() =>
  import('./components/WorksheetEditor').then((module) => ({
    default: module.WorksheetEditor
  }))
)

function createOptimisticQuery(
  activeStatement: Statement,
  databaseId: string | null | undefined,
  worksheetId: string | null | undefined
): QueryDto {
  return {
    content: activeStatement.text,
    databaseId: databaseId ?? '',
    error: null,
    finishedAt: null,
    id: v7(),
    queriedAt: Date.now(),
    result: null,
    truncated: false,
    worksheetId: worksheetId ?? ''
  }
}

function useActiveStatement(openWorksheetId: string | undefined) {
  const worksheets = useWorksheets()

  // The character offset drives statement detection; the status bar's line and
  // column are reported separately so neither has to derive the other.
  const [cursorOffset, setCursorOffset] = useState<number>(0)

  const currentWorksheet = useMemo(
    () => worksheets.data.find((worksheet) => worksheet.id === openWorksheetId),
    [worksheets.data, openWorksheetId]
  )

  const statements = useMemo(() => {
    if (!currentWorksheet?.content) {
      return []
    }

    return createAstFromSql(currentWorksheet.content).statements
  }, [currentWorksheet?.content])

  const activeStatementIndex = useMemo(
    () => findActiveStatementIndex(statements, cursorOffset),
    [statements, cursorOffset]
  )

  const activeStatement =
    activeStatementIndex === null ? null : statements[activeStatementIndex]

  return {
    activeStatement,
    activeStatementIndex,
    currentWorksheet,
    setCursorOffset,
    statements
  }
}

function useCancelRunningQuery(query: QueryDto | undefined) {
  const cancelQuery = useCancelQuery()

  const { cancel: cancelQueryById } = cancelQuery

  const handleCancelQuery = useCallback(() => {
    if (query?.id) {
      cancelQueryById(query.id)
    }
  }, [cancelQueryById, query?.id])

  return { handleCancelQuery, isCancelPending: cancelQuery.isPending }
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
  databaseId: string | null | undefined,
  worksheetId: string | undefined
) {
  const { queries: queriesCollection } = useCollections()

  return useCallback(() => {
    if (!activeStatement) {
      console.error('No active statement')

      return
    }

    const optimistic = createOptimisticQuery(
      activeStatement,
      databaseId,
      worksheetId
    )

    startQueryTrace(optimistic)

    const transaction = queriesCollection.insert(optimistic)

    // The optimistic row rolls back automatically if the create fails.
    void transaction.isPersisted.promise.catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : 'Failed to run query'

      finishQueryTrace({ error: message, id: optimistic.id })
      toast.error('Query failed', { description: message })
    })
  }, [activeStatement, databaseId, worksheetId, queriesCollection])
}

export function App(): ReactElement {
  const databases = useDatabases()

  const openWorksheetId = useAppSelector(selectActiveWorksheetId)
  const editorScreen = useAppSelector((state) => state.ui.editorScreen)

  const showGettingStartedScreen = databases.data.length === 0

  const [cursorPosition, setCursorPosition] = useState<CursorPosition>()

  const {
    activeStatement,
    activeStatementIndex,
    currentWorksheet,
    setCursorOffset,
    statements
  } = useActiveStatement(openWorksheetId)

  const query = useLatestQuery(openWorksheetId)

  useQueryResultSync(query)

  const isQueryRunning = Boolean(query && !query.finishedAt)

  const { handleCancelQuery, isCancelPending } = useCancelRunningQuery(query)

  const { handleUpdateContent, saveState } =
    useWorksheetAutosave(openWorksheetId)

  const handleRunQuery = useRunQuery(
    activeStatement,
    currentWorksheet?.databaseId,
    openWorksheetId
  )

  const currentDatabase = useMemo(
    () =>
      databases.data.find(
        (database) => database.id === currentWorksheet?.databaseId
      ),
    [databases.data, currentWorksheet?.databaseId]
  )

  return (
    <main className="w-full h-screen flex flex-col bg-panel2 overflow-hidden text-sm">
      {showGettingStartedScreen && <GettingStartedScreen />}

      {editorScreen && (
        <EditorScreen
          databaseId={editorScreen.databaseId}
          mode={editorScreen.type === 'create-database' ? 'create' : 'edit'}
        />
      )}

      <TitleBar />

      <div className="flex-1 min-h-0 flex">
        <AppSidebar />

        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          <WorksheetTabs />

          <WorksheetToolbar
            activeStatement={activeStatement}
            isCancelPending={isCancelPending}
            isQueryRunning={isQueryRunning}
            onCancelQuery={handleCancelQuery}
            onRunQuery={handleRunQuery}
          />

          <div className="flex-1 min-h-0 bg-panel">
            {currentWorksheet ? (
              <Suspense fallback={null}>
                <WorksheetEditor
                  activeStatementIndex={activeStatementIndex}
                  content={currentWorksheet.content}
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
            databaseId={currentWorksheet?.databaseId ?? undefined}
            databaseName={currentDatabase?.name}
            query={query}
            saveState={saveState}
          />
        </div>
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
