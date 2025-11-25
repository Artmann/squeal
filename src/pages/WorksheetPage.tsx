import { useState } from 'react'

import { WorksheetEditor } from '../components/WorksheetEditor'

export function WorksheetPage() {
  const [results, setResults] = useState<string | null>(null)

  const handleExecute = (sql: string) => {
    console.log('Executing SQL:', sql)
    setResults(`Query executed: ${sql}`)
  }

  return (
    <div className="flex flex-col h-screen">
      <div className="flex-1 min-h-0">
        <WorksheetEditor
          initialContent="SELECT * FROM users;"
          onExecute={handleExecute}
        />
      </div>

      {results && (
        <div className="h-48 border-t border-border bg-muted/20 p-4 overflow-auto">
          <h3 className="text-sm font-medium mb-2">Results</h3>
          <pre className="text-xs font-mono">{results}</pre>
        </div>
      )}
    </div>
  )
}
