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
import { createAstFromSql } from './sql-parser'

const WorksheetEditor = lazy(() =>
  import('./components/WorksheetEditor').then((module) => ({
    default: module.WorksheetEditor
  }))
)

export function App(): ReactElement {
  const databases = useDatabases()
  const worksheets = useWorksheets()
  const queries = useQueriesList()

  const openWorksheetId = useAppSelector(
    (state) => state.editor.openWorksheetId
  )
  const editorScreen = useAppSelector((state) => state.ui.editorScreen)

  const showGettingStartedScreen = databases.data.length === 0

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

  const activeStatementIndex = useMemo(() => {
    if (statements.length === 0) {
      return null
    }

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i]

      if (
        cursorPosition >= statement.start &&
        cursorPosition <= statement.end
      ) {
        return i
      }
    }

    for (let i = statements.length - 1; i >= 0; i--) {
      const statement = statements[i]

      if (cursorPosition >= statement.end) {
        return i
      }
    }

    return null
  }, [statements, cursorPosition])

  const activeStatement = useMemo(() => {
    if (activeStatementIndex === null) {
      return null
    }

    return statements[activeStatementIndex]
  }, [statements, activeStatementIndex])

  const query = useMemo(() => {
    const sorted = queries.data
      .filter((q) => q.worksheetId === openWorksheetId)
      .sort((a, b) => b.queriedAt - a.queriedAt)

    return sorted[0]
  }, [queries.data, openWorksheetId])

  useQueryResultSync(query)

  const isQueryRunning = Boolean(query && !query.finishedAt)

  const { queries: queriesCollection } = useCollections()
  const cancelQuery = useCancelQuery()

  const { cancel: cancelQueryById } = cancelQuery

  const handleCancelQuery = useCallback(() => {
    if (query?.id) {
      cancelQueryById(query.id)
    }
  }, [cancelQueryById, query?.id])

  const { handleUpdateContent, saveState } =
    useWorksheetAutosave(openWorksheetId)

  const handleRunQuery = useCallback(() => {
    if (!activeStatement) {
      console.error('No active statement')

      return
    }

    const optimistic: QueryDto = {
      content: activeStatement.text,
      databaseId: currentWorksheet?.databaseId ?? '',
      error: null,
      finishedAt: null,
      id: v7(),
      queriedAt: Date.now(),
      result: null,
      truncated: false,
      worksheetId: openWorksheetId ?? ''
    }

    const transaction = queriesCollection.insert(optimistic)

    // The optimistic row rolls back automatically if the create fails.
    void transaction.isPersisted.promise.catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : 'Failed to run query'

      toast.error('Query failed', { description: message })
    })
  }, [
    activeStatement,
    currentWorksheet?.databaseId,
    openWorksheetId,
    queriesCollection
  ])

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
                isCancelPending={cancelQuery.isPending}
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
