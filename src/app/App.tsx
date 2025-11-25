import { ReactElement, useState } from 'react'

import { WorksheetEditor } from './components/WorksheetEditor'
import { Button } from './components/ui/button'

const apiBaseUrl = `http://localhost:7847`
const POLL_INTERVAL = 500

interface QueryResult {
  id: string
  content: string
  error: string | null
  queriedAt: number
  result: string | null
}

async function pollForResult(queryId: string): Promise<QueryResult> {
  while (true) {
    const response = await fetch(`${apiBaseUrl}/queries/${queryId}`)

    if (!response.ok) {
      throw new Error(`Failed to fetch query: ${response.statusText}`)
    }

    const data = await response.json()
    const query: QueryResult = data.query

    if (query.result !== null || query.error !== null) {
      return query
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL))
  }
}

export function App(): ReactElement {
  const [content, setContent] = useState('SELECT * FROM users;')
  const [isRunning, setIsRunning] = useState(false)
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null)

  const handleRunQuery = async () => {
    setIsRunning(true)
    setQueryResult(null)

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

      const result = await pollForResult(createdQuery.id)
      setQueryResult(result)
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

      <div className="flex-1">
        <header className="w-full p-3 border-b border-border">
          <Button
            onClick={handleRunQuery}
            disabled={isRunning}
          >
            {isRunning ? 'Running...' : 'Run'}
          </Button>
        </header>

        <div className="bg-background">
          <WorksheetEditor
            content={content}
            onChange={setContent}
          />
          <div>
            {queryResult?.error && (
              <pre className="text-red-500 p-4">{queryResult.error}</pre>
            )}
            {queryResult?.result && (
              <pre className="p-4">{queryResult.result}</pre>
            )}
            {!queryResult && (
              <div className="p-4 text-muted-foreground">Results</div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
