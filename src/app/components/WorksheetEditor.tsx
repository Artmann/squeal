import { autocompletion } from '@codemirror/autocomplete'
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
import { findGutterMarkerPositions } from './worksheet-editor-lines'

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

  const handleClickOutsideTheEditor = useCallback(() => {
    if (editorRef.current) {
      const view = editorRef.current.view

      if (view) {
        view.focus()
      }
    }
  }, [])

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
      autocompletion(),
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

      const positions = findGutterMarkerPositions(
        state.doc.toString(),
        activeStatement
      )

      for (const position of positions) {
        builder.add(position, position, activeStatementMarker)
      }

      return builder.finish()
    })
  }, [activeStatement])

  return (
    <div className="w-full h-full overflow-hidden text-xs flex flex-col">
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
      <button
        aria-label="Focus editor"
        className="w-full flex-1 cursor-text"
        onClick={handleClickOutsideTheEditor}
        type="button"
      />
    </div>
  )
}

class ActiveStatementMarker extends GutterMarker {
  override elementClass = 'cm-activeStatementGutter'
}

const activeStatementMarker = new ActiveStatementMarker()
