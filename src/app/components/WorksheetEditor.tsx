import { autocompletion } from '@codemirror/autocomplete'
import { sql } from '@codemirror/lang-sql'
import {
  Compartment,
  type Extension,
  Prec,
  RangeSetBuilder
} from '@codemirror/state'
import type { ViewUpdate } from '@codemirror/view'
import {
  EditorView,
  GutterMarker,
  gutterLineClass,
  keymap
} from '@codemirror/view'
import CodeMirror, { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { Sparkles } from 'lucide-react'
import { ReactElement, useCallback, useEffect, useMemo, useRef } from 'react'
import { toast } from 'sonner'

import type { DatabaseType } from '@/glue/api/schemas'
import { type Statement } from '../sql-parser'
import { squealEditorTheme, squealHighlighting } from './codemirror-theme'
import { formatEditorContent } from './worksheet-editor-format'
import {
  type CursorPosition,
  isSameCursorPosition,
  toCursorPosition
} from './worksheet-editor-cursor'
import { findGutterMarkerPositions } from './worksheet-editor-lines'

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

// Hoisted out of the render on purpose. `@uiw/react-codemirror` lists
// `basicSetup` — along with `extensions`, `onChange` and `onUpdate` — in the deps
// of the effect that dispatches `StateEffect.reconfigure`, and every reconfigure
// re-runs `EditorView.theme`, which allocates a new class name and a new
// StyleModule that style-mod appends to the document and never removes. A fresh
// object literal here therefore leaked CSS rules and re-serialized the whole
// stylesheet on every keystroke, so typing got slower the longer the app stayed
// open. Every prop this component hands CodeMirror has to keep its identity.
//
// `autocompletion` is off because the extension list below registers it
// explicitly; basicSetup only leaves an option out when it is literally `false`,
// so without this it would be registered twice.
const editorBasicSetup = {
  autocompletion: false,
  bracketMatching: true,
  highlightActiveLine: true,
  history: true,
  lineNumbers: true
}

// Formatting itself lives in `worksheet-editor-format` so it can be tested
// against a real EditorState without mounting the component; this only turns a
// parse failure into something the user sees.
function runFormatCommand(
  view: EditorView,
  databaseType: DatabaseType | undefined
): void {
  const outcome = formatEditorContent(view, databaseType)

  if (outcome !== 'parse-error') {
    return
  }

  toast.error('Could not format this SQL', {
    description:
      'The statement has a syntax error the formatter could not parse. Fix it and try again.'
  })
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

  const activeStatementRef = useRef(activeStatement)
  const databaseTypeRef = useRef(databaseType)
  const editorRef = useRef<ReactCodeMirrorRef>(null)
  const gutterCompartment = useMemo(() => new Compartment(), [])
  const lastCursorPositionRef = useRef<CursorPosition | null>(null)
  const onChangeRef = useRef(onChange)
  const onCursorChangeRef = useRef(onCursorChange)
  const onCursorPositionChangeRef = useRef(onCursorPositionChange)
  const onRunQueryRef = useRef(onRunQuery)

  // The keymap and the callbacks handed to CodeMirror are built once, so they
  // read the current props through refs rather than being rebuilt on every
  // change. Syncing them in an effect rather than during render keeps the render
  // pure; they only fire on user input, which is always after the effect has
  // run.
  useEffect(() => {
    activeStatementRef.current = activeStatement
    databaseTypeRef.current = databaseType
    onChangeRef.current = onChange
    onCursorChangeRef.current = onCursorChange
    onCursorPositionChangeRef.current = onCursorPositionChange
    onRunQueryRef.current = onRunQuery
  })

  const handleChange = useCallback((value: string) => {
    onChangeRef.current?.(value)
  }, [])

  const handleClickOutsideTheEditor = useCallback(() => {
    if (editorRef.current) {
      const view = editorRef.current.view

      if (view) {
        view.focus()
      }
    }
  }, [])

  const handleFormatQuery = useCallback(() => {
    const view = editorRef.current?.view

    if (!view) {
      return
    }

    runFormatCommand(view, databaseTypeRef.current)
    view.focus()
  }, [])

  const handleUpdate = useCallback((update: ViewUpdate) => {
    const offset = update.state.selection.main.head
    const position = toCursorPosition(update.state.doc.lineAt(offset), offset)

    if (isSameCursorPosition(lastCursorPositionRef.current, position)) {
      return
    }

    lastCursorPositionRef.current = position

    onCursorPositionChangeRef.current?.(position.offset)
    onCursorChangeRef.current?.(position)
  }, [])

  const extensions = useMemo(() => {
    return [
      squealEditorTheme,
      squealHighlighting,
      sql(),
      EditorView.lineWrapping,
      autocompletion(),
      // The gutter is the one extension that depends on props, so it lives in a
      // Compartment and is swapped by the effect below. Rebuilding the array
      // instead would change the `extensions` identity and reconfigure the whole
      // editor on every keystroke.
      gutterCompartment.of(activeStatementGutter(activeStatementRef.current)),
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              if (onRunQueryRef.current) {
                onRunQueryRef.current()

                return true
              }

              return false
            }
          },
          {
            key: 'Mod-Shift-f',
            run: (view) => {
              runFormatCommand(view, databaseTypeRef.current)

              return true
            }
          }
        ])
      )
    ]
  }, [gutterCompartment])

  // Swapping just this compartment leaves the rest of the configuration — and
  // the `extensions` array's identity — untouched.
  useEffect(() => {
    const view = editorRef.current?.view

    if (!view) {
      return
    }

    view.dispatch({
      effects: gutterCompartment.reconfigure(
        activeStatementGutter(activeStatement)
      )
    })
  }, [activeStatement, gutterCompartment])

  return (
    <div className="relative w-full h-full overflow-hidden text-xs flex flex-col">
      <button
        className="absolute top-[10px] right-[14px] z-20 flex size-7 items-center justify-center rounded-sm border border-border bg-panel text-text3 opacity-75 hover:bg-hover hover:text-text hover:opacity-100"
        onClick={handleFormatQuery}
        title="Format query"
        type="button"
      >
        <Sparkles className="size-3.5" />
      </button>

      <CodeMirror
        ref={editorRef}
        basicSetup={editorBasicSetup}
        extensions={extensions}
        height="100%"
        theme="none"
        value={content}
        onChange={handleChange}
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

// Marks the gutter lines the active statement spans. Recomputed whenever the
// document changes, and rebuilt from scratch whenever the active statement moves
// — which is what the compartment in the component swaps.
function activeStatementGutter(activeStatement: Statement | null): Extension {
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
}
