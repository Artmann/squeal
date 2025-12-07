import { autocompletion, completeFromList } from '@codemirror/autocomplete'
import { sql } from '@codemirror/lang-sql'
import { Prec, RangeSetBuilder, StateField } from '@codemirror/state'
import {
  EditorView,
  GutterMarker,
  gutterLineClass,
  keymap
} from '@codemirror/view'
import CodeMirror from '@uiw/react-codemirror'
import { ReactElement, useMemo, useState } from 'react'

import { catppuccinHighlighting, catppuccinTheme } from './codemirror-theme'
import { createAstFromSql, type Statement } from '../sql-parser'

class ActiveStatementMarker extends GutterMarker {
  override elementClass = 'cm-activeStatementGutter'
}

const activeStatementMarker = new ActiveStatementMarker()

const activeStatementGutterField = StateField.define({
  create(state) {
    return computeActiveStatementGutter(state.doc.toString(), 0)
  },
  update(value, transaction) {
    if (transaction.docChanged || transaction.selection) {
      const position = transaction.state.selection.main.head

      return computeActiveStatementGutter(
        transaction.state.doc.toString(),
        position
      )
    }

    return value
  }
})

function computeActiveStatementGutter(content: string, position: number) {
  const builder = new RangeSetBuilder<GutterMarker>()
  const script = createAstFromSql(content)
  const activeStatement = findActiveStatement(script.statements, position)

  if (!activeStatement) {
    return builder.finish()
  }

  // Convert character positions to line positions.
  let lineStart = 0
  let startLine = -1
  let endLine = -1
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const lineEnd = lineStart + lines[i].length

    if (startLine === -1 && activeStatement.start <= lineEnd) {
      startLine = i
    }

    if (activeStatement.end <= lineEnd + 1) {
      endLine = i
      break
    }

    lineStart = lineEnd + 1
  }

  if (startLine === -1) {
    return builder.finish()
  }

  if (endLine === -1) {
    endLine = lines.length - 1
  }

  // Build ranges for each line in the active statement.
  let charPos = 0

  for (let i = 0; i < lines.length; i++) {
    if (i >= startLine && i <= endLine) {
      builder.add(charPos, charPos, activeStatementMarker)
    }

    charPos += lines[i].length + 1
  }

  return builder.finish()
}

function findActiveStatement(
  statements: Statement[],
  position: number
): Statement | null {
  for (const statement of statements) {
    if (position >= statement.start && position <= statement.end) {
      return statement
    }
  }

  // If there's not an exact match, fallback to the previous statement.
  for (let i = statements.length - 1; i >= 0; i--) {
    if (position > statements[i].end) {
      return statements[i]
    }
  }

  return null
}

const activeStatementGutter = gutterLineClass.from(activeStatementGutterField)

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
      activeStatementGutterField,
      activeStatementGutter,
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
