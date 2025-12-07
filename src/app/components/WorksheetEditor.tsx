import { autocompletion, completeFromList } from '@codemirror/autocomplete'
import { sql } from '@codemirror/lang-sql'
import { Prec } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import CodeMirror from '@uiw/react-codemirror'
import { ReactElement, useMemo, useState } from 'react'

import { catppuccinHighlighting, catppuccinTheme } from './codemirror-theme'
import { createAstFromSql, type Statement } from '../sql-parser'

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
  const [statements, setStatements] = useState<Statement[]>(() => {
    const script = createAstFromSql(content)

    return script.statements
  })
  const [activeStatementIndex, setActiveStatementIndex] = useState<
    number | null
  >(null)

  const extensions = useMemo(() => {
    return [
      catppuccinTheme,
      catppuccinHighlighting,
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
      EditorView.updateListener.of((update) => {
        if (update.selectionSet || update.docChanged) {
          const content = update.state.doc.toString()
          const position = update.state.selection.main.head

          const script = createAstFromSql(content)

          const index = findTheActiveStatementIndex(script.statements, position)

          setStatements(script.statements)
          setActiveStatementIndex(index)
        }
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

  console.log({ activeStatementIndex, statements })

  return (
    <div className="w-full h-full overflow-hidden text-xs">
      <CodeMirror
        basicSetup={{
          bracketMatching: true,
          highlightActiveLine: true,
          history: true,
          lineNumbers: true
        }}
        extensions={extensions}
        height="100%"
        theme="none"
        value={content}
        onChange={(value) => {
          onChange?.(value)
        }}
      />
    </div>
  )
}

function findTheActiveStatementIndex(
  statements: Statement[],
  position: number
): number | null {
  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i]

    if (position >= statement.start && position <= statement.end) {
      return i
    }
  }

  // If there's not an exact match, we'll try to fallback to the
  // previous statement.
  for (let i = statements.length - 1; i >= 0; i--) {
    const statement = statements[i]

    if (position > statement.end) {
      return i
    }
  }

  return null
}
