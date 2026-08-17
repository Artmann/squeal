import CodeMirror from '@uiw/react-codemirror'
import { Sparkles } from 'lucide-react'
import { ReactElement } from 'react'

import type { DatabaseType } from '@/glue/api/schemas'
import { type Statement } from '../sql-parser'
import { useWorksheetEditor } from './use-worksheet-editor'
import { type CursorPosition } from './worksheet-editor-cursor'

export interface WorksheetEditorProps {
  activeStatementIndex: number | null
  content: string
  databaseType?: DatabaseType
  statements: Statement[]
  onChange?: (value: string) => void
  onCursorChange?: (position: CursorPosition) => void
  onCursorPositionChange?: (position: number) => void
  onRunQuery?: () => void
}

export function WorksheetEditor({
  activeStatementIndex,
  content,
  databaseType,
  statements,
  onChange,
  onCursorChange,
  onCursorPositionChange,
  onRunQuery
}: WorksheetEditorProps): ReactElement {
  const activeStatement =
    activeStatementIndex !== null ? statements[activeStatementIndex] : null

  // Every prop below comes from the hook already identity-stable; handing
  // `<CodeMirror>` a fresh object, array or callback reconfigures the whole
  // editor. See `use-worksheet-editor` for what that costs.
  const editor = useWorksheetEditor({
    activeStatement,
    databaseType,
    onChange,
    onCursorChange,
    onCursorPositionChange,
    onRunQuery
  })

  return (
    <div className="relative w-full h-full overflow-hidden text-xs flex flex-col">
      <button
        className="absolute top-[10px] right-[14px] z-20 flex size-7 items-center justify-center rounded-sm border border-border bg-panel text-text3 opacity-75 hover:bg-hover hover:text-text hover:opacity-100"
        onClick={editor.formatQuery}
        title="Format query"
        type="button"
      >
        <Sparkles className="size-3.5" />
      </button>

      <CodeMirror
        ref={editor.editorRef}
        basicSetup={editor.basicSetup}
        extensions={editor.extensions}
        height="100%"
        theme="none"
        value={content}
        onChange={editor.handleChange}
        onUpdate={editor.handleUpdate}
      />
      <button
        aria-label="Focus editor"
        className="w-full flex-1 cursor-text"
        onClick={editor.focusEditor}
        type="button"
      />
    </div>
  )
}
