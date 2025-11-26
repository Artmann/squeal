import { ReactElement, useState } from 'react'

import { GetQueryResponse, QueryDto } from '@/main/queries'
import { WorksheetEditor } from './components/WorksheetEditor'
import { QueryResultTable } from './components/QueryResultTable'
import { Button } from './components/ui/button'
import { ResultSheet } from './components/ResultSheet'
import { Separator } from './components/ui/separator'
import dayjs from 'dayjs'

const apiBaseUrl = `http://localhost:7847`
const pollInterval = 500

interface QueryResult {
  id: string
  content: string
  error: string | null
  queriedAt: number
  result: string | null
}

async function pollForResult(queryId: string): Promise<QueryDto> {
  while (true) {
    const response = await fetch(`${apiBaseUrl}/queries/${queryId}`)

    if (!response.ok) {
      throw new Error(`Failed to fetch query: ${response.statusText}`)
    }

    const data = (await response.json()) as GetQueryResponse
    const query = data.query

    if (query.result !== null || query.error !== null) {
      return query
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval))
  }
}

export function App(): ReactElement {
  const [content, setContent] = useState('SELECT * FROM actor;')
  const [isRunning, setIsRunning] = useState(false)
  const [queryResult, setQueryResult] = useState<any>(null)
  const [queryError, setQueryError] = useState<string | null>(null)
  const [query, setQuery] = useState<QueryDto | null>(null)

  const handleRunQuery = async () => {
    setIsRunning(true)
    setQueryResult(null)
    setQueryError(null)
    setQuery(null)

    try {
      const response = await fetch(`${apiBaseUrl}/queries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: content })
      })

      if (!response.ok) {
        throw new Error(`Query failed: ${response.statusText}`)
      }

      const data = await response.json()
      const createdQuery: QueryResult = data.query

      const finishedQuery = await pollForResult(createdQuery.id)

      setQuery(finishedQuery)
      if (finishedQuery.error) {
        setQueryError(finishedQuery.error)
      }

      if (finishedQuery.result) {
        setQueryResult({
          result: finishedQuery.result
        })
      }
    } catch (error) {
      console.error('Error running query:', error)
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <main className="w-full h-screen flex bg-muted overflow-hidden">
      <div className="h-full flex flex-col border-r border-border">
        <header className="flex pt-3">
          <div className="px-3">Databases</div>
          <div className="px-3">Worksheets</div>
        </header>

        <div className="flex-1 px-3">Sidebar</div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <header className="w-full p-3 border-b border-border">
          <Button
            onClick={handleRunQuery}
            disabled={isRunning}
          >
            {isRunning ? 'Running...' : 'Run'}
          </Button>
        </header>

        <div className="relative flex-1 bg-background">
          <WorksheetEditor
            content={content}
            onChange={setContent}
          />

          <ResultSheet
            isOpen={true}
            query={query}
          >
            {isRunning && (
              <div className="w-full h-full flex justify-center items-center">
                <div className="w-full max-w-sm flex flex-col gap-2">
                  <h2 className="text-lg font-medium">Running query</h2>

                  <Separator />

                  <div className="text-muted-foreground text-sm">
                    <div className="flex items-center justify-between">
                      <div>Start time</div>
                      <div className="text-right">
                        {query?.queriedAt &&
                          dayjs(query.queriedAt).format('YYYY-MM-DD HH:mm:ss')}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {query?.result && <QueryResultTable result={query.result} />}

            {queryError && (
              <div className="w-full h-full flex justify-center items-center">
                {queryError}
              </div>
            )}
          </ResultSheet>
        </div>
      </div>
    </main>
  )
}
