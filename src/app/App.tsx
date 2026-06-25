import dayjs from 'dayjs'
import { Loader2Icon, PlayIcon, XCircleIcon } from 'lucide-react'
import {
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { toast } from 'sonner'
import invariant from 'tiny-invariant'
import { v7 } from 'uuid'

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
import {
  useDatabases,
  useQueriesList,
  useQueryById,
  useWorksheets
} from './hooks/queries'
import { useCreateQuery, useUpdateWorksheet } from './hooks/mutations'
import { useAppSelector } from './store'
import { createAstFromSql } from './sql-parser'

const saveDebounceMs = 300

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

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
    () =>
      worksheets.data.find((worksheet) => worksheet.id === openWorksheetId),
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

  const latestQueryForWorksheet = useMemo(() => {
    const sorted = queries.data
      .filter((q) => q.worksheetId === openWorksheetId)
      .sort((a, b) => b.queriedAt - a.queriedAt)

    return sorted[0]
  }, [queries.data, openWorksheetId])

  const liveQueryResult = useQueryById(latestQueryForWorksheet?.id)
  const query = liveQueryResult.data ?? latestQueryForWorksheet

  const isQueryRunning = Boolean(query && !query.finishedAt)

  const updateWorksheet = useUpdateWorksheet()
  const createQuery = useCreateQuery()

  const { mutate: mutateWorksheet } = updateWorksheet

  const saveTimer = useRef<NodeJS.Timeout | undefined>(undefined)
  const pendingSave = useRef<{ content: string; id: string } | undefined>(
    undefined
  )
  const [saveState, setSaveState] = useState<SaveState>('idle')

  const flushSave = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = undefined
    }

    const pending = pendingSave.current

    if (!pending) {
      return
    }

    pendingSave.current = undefined

    mutateWorksheet(
      { id: pending.id, updates: { content: pending.content } },
      {
        onSuccess: () => {
          setSaveState('saved')
        },
        onError: () => {
          setSaveState('error')
          toast.error('Failed to save worksheet')
        }
      }
    )
  }, [mutateWorksheet])

  useEffect(() => {
    // Flush any pending save when switching worksheets or unmounting so the
    // last edits are never dropped inside the debounce window.
    return () => {
      flushSave()
    }
  }, [flushSave, openWorksheetId])

  const handleUpdateContent = useCallback(
    (newContent: string) => {
      invariant(openWorksheetId, 'No worksheet is open')

      pendingSave.current = { content: newContent, id: openWorksheetId }

      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
      }

      setSaveState('saving')

      saveTimer.current = setTimeout(flushSave, saveDebounceMs)
    },
    [flushSave, openWorksheetId]
  )

  const handleRunQuery = useCallback(() => {
    if (!activeStatement) {
      console.error('No active statement')

      return
    }

    const queryId = v7()
    const queriedAt = Date.now()

    createQuery.mutate(
      {
        content: activeStatement.text,
        databaseId: currentWorksheet?.databaseId ?? undefined,
        id: queryId,
        queriedAt,
        worksheetId: openWorksheetId ?? ''
      },
      {
        onError: (error) => {
          const message =
            error instanceof Error ? error.message : 'Failed to run query'

          toast.error('Query failed', { description: message })
        }
      }
    )
  }, [activeStatement, createQuery, currentWorksheet?.databaseId, openWorksheetId])

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
          <header className="w-full p-3 border-b border-surface-0 flex items-center gap-3 justify-between">
            <Button
              className="cursor-pointer"
              disabled={isQueryRunning || !activeStatement}
              size="icon-sm"
              onClick={handleRunQuery}
            >
              {isQueryRunning ? (
                <Loader2Icon className="size-3 animate-spin" />
              ) : (
                <PlayIcon className="size-3" />
              )}
            </Button>

            <div className="flex items-center gap-3">
              <SaveIndicator state={saveState} />
              <DatabaseSelector />
            </div>
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
                <div className="w-full h-full flex justify-center items-center p-6">
                  <div className="w-full max-w-lg flex flex-col gap-3">
                    <div className="flex items-center gap-2 text-red font-medium text-sm">
                      <XCircleIcon className="size-4 shrink-0" />
                      Query failed
                    </div>

                    <pre className="text-xs text-subtext-0 font-mono whitespace-pre-wrap bg-surface-0 rounded-md p-3 border border-surface-1">
                      {query.error}
                    </pre>
                  </div>
                </div>
              )}
            </ResultSheet>
          </div>
        </div>
      </div>
    </main>
  )
}

function SaveIndicator({
  state
}: {
  state: SaveState
}): ReactElement | null {
  if (state === 'idle') {
    return null
  }

  const text =
    state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : 'Save failed'

  const className =
    state === 'error' ? 'text-red text-xs' : 'text-subtext-0 text-xs'

  return <span className={className}>{text}</span>
}
