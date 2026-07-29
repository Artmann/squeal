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
import { QueryResultContent } from './components/QueryResultContent'
import { ResultSheet } from './components/ResultSheet'
import { TitleBar } from './components/TitleBar'
import { WorksheetHeader } from './components/WorksheetHeader'
import { useCollections } from './collections-context'
import {
  useDatabases,
  useQueriesList,
  useQueryResultSync,
  useWorksheets
} from './hooks/queries'
import { useCancelQuery } from './hooks/mutations'
import { useWorksheetAutosave } from './hooks/useWorksheetAutosave'
import { QueryDto } from '@/main/queries'
import { useAppSelector } from './store'
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
  const [cursorPosition, setCursorPosition] = useState<number>(0)

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
    () => findActiveStatementIndex(statements, cursorPosition),
    [statements, cursorPosition]
  )

  const activeStatement =
    activeStatementIndex === null ? null : statements[activeStatementIndex]

  return {
    activeStatement,
    activeStatementIndex,
    currentWorksheet,
    setCursorPosition,
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

  const openWorksheetId = useAppSelector(
    (state) => state.editor.openWorksheetId
  )
  const editorScreen = useAppSelector((state) => state.ui.editorScreen)

  const showGettingStartedScreen = databases.data.length === 0

  const {
    activeStatement,
    activeStatementIndex,
    currentWorksheet,
    setCursorPosition,
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

  if (!currentWorksheet) {
    return (
      <main className="w-full h-screen flex flex-col bg-mantle overflow-hidden text-sm">
        {showGettingStartedScreen && <GettingStartedScreen />}

        <TitleBar />
      </main>
    )
  }

  return (
    <main className="w-full h-screen flex flex-col bg-mantle overflow-hidden text-sm">
      {showGettingStartedScreen && <GettingStartedScreen />}

      {editorScreen && (
        <EditorScreen
          databaseId={editorScreen.databaseId}
          mode={editorScreen.type === 'create-database' ? 'create' : 'edit'}
        />
      )}

      <TitleBar />

      <div className="flex-1 min-h-0 flex">
        <div className="h-full flex flex-col border-r border-surface-0">
          <AppSidebar />
        </div>

        <div className="flex-1 min-h-0 flex flex-col">
          <WorksheetHeader
            activeStatement={activeStatement}
            isQueryRunning={isQueryRunning}
            saveState={saveState}
            onRunQuery={handleRunQuery}
          />

          <div className="relative flex-1 min-h-0 bg-base">
            <Suspense fallback={null}>
              <WorksheetEditor
                activeStatementIndex={activeStatementIndex}
                content={currentWorksheet.content}
                statements={statements}
                onChange={handleUpdateContent}
                onCursorPositionChange={setCursorPosition}
                onRunQuery={handleRunQuery}
              />
            </Suspense>

            <ResultSheet
              isOpen={Boolean(query)}
              query={query}
            >
              <QueryResultContent
                isCancelPending={isCancelPending}
                isQueryRunning={isQueryRunning}
                query={query}
                onCancelQuery={handleCancelQuery}
              />
            </ResultSheet>
          </div>
        </div>
      </div>
    </main>
  )
}
