import { autocompletion, completeFromList } from '@codemirror/autocomplete'
import { sql } from '@codemirror/lang-sql'
import { Prec } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import CodeMirror from '@uiw/react-codemirror'

import { ReactElement, useMemo } from 'react'

interface WorksheetEditorProps {
  content: string
  onChange?: (value: string) => void
  onRunQuery?: () => void
}

export function WorksheetEditor({
  content,
  onChange,
  onRunQuery
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
      }),
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              if (onRunQuery) {
                onRunQuery()

                return true
              }
            }
          }
        ])
      )
    ]
  }, [])

  return (
    <div className="w-full h-full overflow-hidden">
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
