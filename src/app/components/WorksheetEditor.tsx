import CodeMirror from '@uiw/react-codemirror'
import { sql } from '@codemirror/lang-sql'
import { autocompletion, completeFromList } from '@codemirror/autocomplete'
import { EditorView } from '@codemirror/view'
import { ReactElement, useMemo } from 'react'

interface WorksheetEditorProps {
  content: string
  onChange?: (value: string) => void
}

export function WorksheetEditor({
  content,
  onChange
}: WorksheetEditorProps): ReactElement {
  const extensions = useMemo(() => {
    return [
      sql(),
      EditorView.lineWrapping,
      autocompletion({
        override: [
          completeFromList([
            { label: 'SELECT', type: 'keyword', apply: 'SELECT ' },
            { label: 'FROM', type: 'keyword', apply: 'FROM ' },
            { label: 'users', type: 'table', apply: 'users' },
            { label: 'orders', type: 'table', apply: 'orders' }
          ])
        ]
      })
    ]
  }, [])

  return (
    <div className="h-80 w-full overflow-hidden rounded-2xl border bg-background">
      <CodeMirror
        basicSetup={{
          bracketMatching: true,
          highlightActiveLine: true,
          history: true,
          lineNumbers: true
        }}
        extensions={extensions}
        height="100%"
        value={content}
        onChange={(value) => {
          onChange?.(value)
        }}
      />
    </div>
  )
}
