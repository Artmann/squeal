import dayjs from 'dayjs'
import { Loader2Icon, PlayIcon } from 'lucide-react'
import { ReactElement, useCallback, useEffect, useMemo, useState } from 'react'
import invariant from 'tiny-invariant'
import { v7 } from 'uuid'

import { QueryDto } from '@/main/queries'
import { apiClient } from './api-client'
import { AppSidebar } from './components/AppSidebar'
import { DatabaseSelector } from './components/DatabaseSelector'
import { EditorScreen } from './components/EditorScreen'
import { GettingStartedScreen } from './components/GettingStartedScreen'
import { QueryResultTable } from './components/QueryResultTable'
import { ResultSheet } from './components/ResultSheet'
import { TitleBar } from './components/TitleBar'
import { Button } from './components/ui/button'
import { Separator } from './components/ui/separator'
import { WorksheetEditor } from './components/WorksheetEditor'
import { useAppDispatch, useAppSelector } from './store'
import { editorSlice, queryCreated, queryFetched } from './store/editor-slice'
import { createAstFromSql } from './sql-parser'

export function App(): ReactElement {
  const queries = useAppSelector((state) => state.editor.queries)
  const worksheets = useAppSelector((state) => state.editor.worksheets)
  const openWorksheetId = useAppSelector(
    (state) => state.editor.openWorksheetId
  )
  const uiState = useAppSelector((state) => state.ui)

  const [cursorPosition, setCursorPosition] = useState<number>(0)

  const currentWorksheet = useMemo(
    () => worksheets.find((worksheet) => worksheet.id === openWorksheetId),
    [worksheets, openWorksheetId]
  )

  const statements = useMemo(() => {
    if (!currentWorksheet?.content) {
      return []
    }

    const parsed = createAstFromSql(currentWorksheet.content).statements
    console.log(
      'Parsed statements:',
      parsed.map((s) => ({
        start: s.start,
        end: s.end,
        text: s.text.substring(0, 30)
      }))
    )

    return parsed
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

    // If the cursor is not within any statement, we'll fall back to the last statement
    // that is before the cursor position.
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

  const [query] = useMemo(
    () =>
      queries
        .filter((q) => q.worksheetId === openWorksheetId)
        .sort((a, b) => b.queriedAt - a.queriedAt),
    [queries, openWorksheetId]
  )

  const isQueryRunning = query && !query.finishedAt

  console.log({
    activeStatementIndex,
    cursorPosition,
    isQueryRunning,
    openWorksheetId,
    queries,
    statements,
    worksheets
  })

  const dispatch = useAppDispatch()

  useEffect(
    function pollQueryResult() {
      let handle: NodeJS.Timeout | undefined

      if (!isQueryRunning) {
        return
      }

      const check = () => {
        if (!query) {
          return
        }

        apiClient
          .getQuery(query.id)
          .then((freshQuery) => {
            dispatch(queryFetched(freshQuery))

            handle = setTimeout(check, pollInterval)
          })
          .catch((error) => {
            console.error('Error fetching query:', error)
          })
      }

      check()

      return () => {
        if (handle) {
          clearTimeout(handle)
        }
      }
    },
    [isQueryRunning, query?.id, dispatch]
  )

  const handleUpdateContent = useCallback(
    async (newContent: string) => {
      invariant(openWorksheetId, 'No worksheet is open')

      dispatch(
        editorSlice.actions.worksheetContentUpdated({
          id: openWorksheetId,
          content: newContent
        })
      )

      void apiClient.updateWorksheet(openWorksheetId, { content: newContent })
    },
    [dispatch, openWorksheetId]
  )

  const handleRunQuery = async () => {
    if (!currentWorksheet?.databaseId) {
      console.error('No database selected')

      return
    }

    if (!activeStatement) {
      console.error('No active statement')

      return
    }

    const queryData: QueryDto = {
      content: activeStatement.text,
      databaseId: currentWorksheet.databaseId,
      error: null,
      id: v7(),
      queriedAt: Date.now(),
      result: null,
      worksheetId: openWorksheetId ?? ''
    }

    dispatch(queryCreated(queryData))

    try {
      const data = await apiClient.createQuery({
        content: queryData.content,
        databaseId: queryData.databaseId,
        id: queryData.id,
        queriedAt: queryData.queriedAt,
        worksheetId: queryData.worksheetId
      })

      dispatch(queryFetched(data.query))
    } catch (error) {
      console.error('Error running query:', error)
    }
  }

  return (
    <main className="w-full h-screen flex flex-col bg-mantle overflow-hidden text-sm">
      {uiState.showGettingStartedScreen && <GettingStartedScreen />}

      {uiState.editorScreen?.type === 'edit-database' && (
        <EditorScreen databaseId={uiState.editorScreen.databaseId} />
      )}

      <TitleBar />

      <div className="flex-1 min-h-0 flex">
        <div className="h-full flex flex-col border-r border-surface-0">
          <AppSidebar />
        </div>

        <div className="flex-1 min-h-0 flex flex-col">
          <header className="w-full p-3 border-b border-surface-0 flex items-center gap-3 justify-between">
            <Button
              className="cursor-pointer"
              disabled={
                isQueryRunning ||
                !currentWorksheet?.databaseId ||
                !activeStatement
              }
              size="icon-sm"
              onClick={handleRunQuery}
            >
              {isQueryRunning ? (
                <Loader2Icon className="size-3 animate-spin" />
              ) : (
                <PlayIcon className="size-3" />
              )}
            </Button>

            <DatabaseSelector />
          </header>

          <div className="relative flex-1 min-h-0 bg-base">
            <WorksheetEditor
              activeStatementIndex={activeStatementIndex}
              content={currentWorksheet.content}
              statements={statements}
              onChange={handleUpdateContent}
              onCursorPositionChange={setCursorPosition}
              onRunQuery={handleRunQuery}
            />

            <ResultSheet
              isOpen={Boolean(query)}
              query={query}
            >
              {isQueryRunning && (
                <div className="w-full h-full flex justify-center items-center">
                  <div className="w-full max-w-sm flex flex-col gap-2">
                    <h2 className="text-lg font-medium">Running query</h2>

                    <Separator />

                    <div className="text-subtext-0 text-sm">
                      <div className="flex items-center justify-between">
                        <div>Start time</div>
                        <div className="text-right">
                          {query?.queriedAt &&
                            dayjs(query.queriedAt).format(
                              'YYYY-MM-DD HH:mm:ss'
                            )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {query?.result && <QueryResultTable result={query.result} />}

              {query?.error && (
                <div className="w-full h-full flex justify-center items-center">
                  {query.error}
                </div>
              )}
            </ResultSheet>
          </div>
        </div>
      </div>
    </main>
  )
}

const pollInterval = 10
