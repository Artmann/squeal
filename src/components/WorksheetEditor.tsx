import { useEffect, useRef } from 'react'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { Schema } from 'prosemirror-model'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap } from 'prosemirror-commands'
import { history, undo, redo } from 'prosemirror-history'

// Simple schema for SQL editing - just plain text with code styling
const sqlSchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      content: 'text*',
      toDOM: () => ['p', { class: 'sql-line' }, 0],
      parseDOM: [{ tag: 'p' }]
    },
    text: { inline: true }
  }
})

interface WorksheetEditorProps {
  initialContent?: string
  onChange?: (content: string) => void
  onExecute?: (sql: string) => void
}

export function WorksheetEditor({
  initialContent = '',
  onChange,
  onExecute
}: WorksheetEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    if (!editorRef.current) return

    const doc = sqlSchema.node('doc', null, [
      sqlSchema.node(
        'paragraph',
        null,
        initialContent ? sqlSchema.text(initialContent) : []
      )
    ])

    const state = EditorState.create({
      doc,
      schema: sqlSchema,
      plugins: [
        history(),
        keymap({
          'Mod-z': undo,
          'Mod-y': redo,
          'Mod-Shift-z': redo,
          'Mod-Enter': (state) => {
            if (onExecute) {
              const content = state.doc.textContent
              onExecute(content)
            }
            return true
          }
        }),
        keymap(baseKeymap)
      ]
    })

    const view = new EditorView(editorRef.current, {
      state,
      dispatchTransaction(transaction) {
        const newState = view.state.apply(transaction)
        view.updateState(newState)

        if (transaction.docChanged && onChange) {
          onChange(newState.doc.textContent)
        }
      },
      attributes: {
        class: 'prosemirror-editor'
      }
    })

    viewRef.current = view

    return () => {
      view.destroy()
    }
  }, [])

  return (
    <div className="worksheet-editor flex flex-col h-full">
      <div className="editor-toolbar flex items-center gap-2 p-2 border-b border-border bg-muted/30">
        <span className="text-xs text-muted-foreground">
          Press Ctrl+Enter to execute
        </span>
      </div>
      <div
        ref={editorRef}
        className="editor-container flex-1 overflow-auto p-4 font-mono text-sm bg-background"
      />
      <style>{`
        .prosemirror-editor {
          outline: none;
          min-height: 100%;
        }
        .prosemirror-editor .sql-line {
          margin: 0;
          padding: 2px 0;
          line-height: 1.5;
        }
        .prosemirror-editor:focus {
          outline: none;
        }
        .ProseMirror-focused {
          outline: none;
        }
      `}</style>
    </div>
  )
}
