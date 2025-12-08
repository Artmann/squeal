import { autocompletion, completeFromList } from '@codemirror/autocomplete'
import { sql } from '@codemirror/lang-sql'
import { Prec, RangeSetBuilder } from '@codemirror/state'
import type { ViewUpdate } from '@codemirror/view'
import {
  EditorView,
  GutterMarker,
  gutterLineClass,
  keymap
} from '@codemirror/view'
import CodeMirror, { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { ReactElement, useCallback, useMemo, useRef } from 'react'

import { type Statement } from '../sql-parser'
import { catppuccinHighlighting, catppuccinTheme } from './codemirror-theme'

export interface WorksheetEditorProps {
  activeStatementIndex: number | null
  content: string
  statements: Statement[]
  onChange?: (value: string) => void
  onCursorPositionChange?: (position: number) => void
  onRunQuery?: () => void
}

export function WorksheetEditor({
  activeStatementIndex,
  content,
  statements,
  onChange,
  onCursorPositionChange,
  onRunQuery
}: WorksheetEditorProps): ReactElement {
  const editorRef = useRef<ReactCodeMirrorRef>(null)
  const onRunQueryRef = useRef(onRunQuery)
  onRunQueryRef.current = onRunQuery

  const handleUpdate = useCallback(
    (update: ViewUpdate) => {
      const position = update.state.selection.main.head

      onCursorPositionChange?.(position)
    },
    [onCursorPositionChange]
  )

  const extensions = useMemo(() => {
    return [
      catppuccinTheme,
      catppuccinHighlighting,
      sql(),
      EditorView.lineWrapping,
      autocompletion({
        override: [
          completeFromList([
            { apply: 'SELECT ', label: 'SELECT', type: 'keyword' },
            { apply: 'FROM ', label: 'FROM', type: 'keyword' },
            { apply: 'users', label: 'users', type: 'table' },
            { apply: 'orders', label: 'orders', type: 'table' }
          ])
        ]
      }),
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              if (onRunQueryRef.current) {
                onRunQueryRef.current()

                return true
              }
            }
          }
        ])
      )
    ]
  }, [])

  const activeStatement =
    activeStatementIndex !== null ? statements[activeStatementIndex] : null

  const gutterExtension = useMemo(() => {
    return gutterLineClass.compute(['doc'], (state) => {
      const builder = new RangeSetBuilder<GutterMarker>()

      if (!activeStatement) {
        return builder.finish()
      }

      const content = state.doc.toString()
      const lines = content.split('\n')

      // Convert character positions to line positions.
      let lineStart = 0
      let startLine = -1
      let endLine = -1

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
    })
  }, [activeStatement])

  return (
    <div className="w-full h-full overflow-hidden text-xs">
      <CodeMirror
        ref={editorRef}
        basicSetup={{
          bracketMatching: true,
          highlightActiveLine: true,
          history: true,
          lineNumbers: true
        }}
        extensions={[...extensions, gutterExtension]}
        height="100%"
        theme="none"
        value={content}
        onChange={(value) => {
          onChange?.(value)
        }}
        onUpdate={handleUpdate}
      />
    </div>
  )
}

class ActiveStatementMarker extends GutterMarker {
  override elementClass = 'cm-activeStatementGutter'
}

const activeStatementMarker = new ActiveStatementMarker()
