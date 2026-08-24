// Everything the SQL editor hands to CodeMirror, kept out of the component.
//
// The one rule this module exists to enforce: every prop that reaches
// `<CodeMirror>` keeps its identity for the life of the editor.
// `@uiw/react-codemirror` lists `basicSetup`, `extensions`, `onChange` and
// `onUpdate` in the deps of the effect that dispatches
// `StateEffect.reconfigure`, and every reconfigure re-runs `EditorView.theme`,
// which allocates a new class name and a new StyleModule that style-mod appends
// to the document and never removes while re-serializing the whole stylesheet.
// An unstable prop therefore leaks CSS rules and re-parses every rule in the
// document on each keystroke, which is why typing used to get slower the longer
// the app stayed open.
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
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { type RefObject, useCallback, useEffect, useMemo, useRef } from 'react'
import { toast } from 'sonner'

import type { DatabaseType } from '@/glue/api/schemas'
import type { Statement } from '../sql-parser'
import { squealEditorTheme, squealHighlighting } from './codemirror-theme'
import {
  type CursorPosition,
  isSameCursorPosition,
  toCursorPosition
} from './worksheet-editor-cursor'
import { formatEditorContent } from './worksheet-editor-format'
import { findGutterMarkerPositions } from './worksheet-editor-lines'

// `autocompletion` is off because the extension list registers it explicitly;
// basicSetup only leaves an option out when it is literally `false`, so without
// this it would be registered twice.
//
// `searchKeymap` is off because the results grid owns Mod-f. That option opts in
// silently -- nothing in the extension list below mentions it -- and it binds
// Mod-f to CodeMirror's own search panel without stopping propagation, so
// leaving it on runs both finds and the grid's steals focus from the panel. The
// editor holds focus by default, so this is the difference between Mod-f
// working straight after a query returns and not.
//
// Turning it off also drops Mod-g, F3, Mod-Alt-g and Mod-d from the editor.
// Putting any of them back means importing `@codemirror/search` here, and this
// tree carries four separate copies of that package at two versions -- the one
// an app import resolves to is not the one basicSetup is built against, so the
// binding would read a different search state than it wrote. Flattening that is
// its own job; until then the editor simply has no find.
//
// It also drops Mod-Shift-l, which is the app's own light/dark toggle -- but
// that key stays dead in the editor regardless: `ThemeProvider` registers it
// without `enableOnContentEditable`, so react-hotkeys-hook declines it on a
// contenteditable target whatever CodeMirror does. Verified in the running app.
// Removing CodeMirror's binding is necessary but not sufficient there.
const editorBasicSetup = {
  autocompletion: false,
  bracketMatching: true,
  highlightActiveLine: true,
  history: true,
  lineNumbers: true,
  searchKeymap: false
}

export interface WorksheetEditorOptions {
  activeStatement: Statement | null
  databaseType: DatabaseType | undefined
  onChange?: (value: string) => void
  onCursorChange?: (position: CursorPosition) => void
  onCursorPositionChange?: (position: number) => void
  onRunQuery?: () => void
}

export interface WorksheetEditor {
  basicSetup: typeof editorBasicSetup
  editorRef: RefObject<ReactCodeMirrorRef | null>
  extensions: Extension[]
  focusEditor: () => void
  formatQuery: () => void
  handleChange: (value: string) => void
  handleUpdate: (update: ViewUpdate) => void
}

export function useWorksheetEditor(
  options: WorksheetEditorOptions
): WorksheetEditor {
  const { activeStatement } = options

  const editorRef = useRef<ReactCodeMirrorRef>(null)
  const gutterCompartment = useMemo(() => new Compartment(), [])
  const lastCursorPositionRef = useRef<CursorPosition | null>(null)

  // One ref for all of it rather than one per callback. The keymap and the
  // handlers are built once, so they read the current props through here instead
  // of being rebuilt on every change. Refreshing it in an effect rather than
  // during render keeps the render pure; they only fire on user input, which is
  // always after the effect has run.
  const latest = useRef(options)

  useEffect(() => {
    latest.current = options
  })

  const extensions = useMemo(
    () => createExtensions({ gutterCompartment, latest }),
    [gutterCompartment, latest]
  )

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

  const focusEditor = useCallback(() => {
    editorRef.current?.view?.focus()
  }, [])

  const formatQuery = useCallback(() => {
    const view = editorRef.current?.view

    if (!view) {
      return
    }

    runFormatCommand(view, latest.current.databaseType)
    view.focus()
  }, [])

  const handleChange = useCallback((value: string) => {
    latest.current.onChange?.(value)
  }, [])

  const handleUpdate = useCallback((update: ViewUpdate) => {
    const offset = update.state.selection.main.head
    const position = toCursorPosition(update.state.doc.lineAt(offset), offset)

    if (isSameCursorPosition(lastCursorPositionRef.current, position)) {
      return
    }

    lastCursorPositionRef.current = position

    latest.current.onCursorPositionChange?.(position.offset)
    latest.current.onCursorChange?.(position)
  }, [])

  return {
    basicSetup: editorBasicSetup,
    editorRef,
    extensions,
    focusEditor,
    formatQuery,
    handleChange,
    handleUpdate
  }
}

// Built once per editor. The active-statement gutter is the only extension that
// depends on props, so it goes in a Compartment the hook swaps; rebuilding the
// array instead would change its identity and reconfigure the whole editor.
function createExtensions(options: {
  gutterCompartment: Compartment
  latest: RefObject<WorksheetEditorOptions>
}): Extension[] {
  const { gutterCompartment, latest } = options

  return [
    squealEditorTheme,
    squealHighlighting,
    sql(),
    EditorView.lineWrapping,
    autocompletion(),
    gutterCompartment.of(activeStatementGutter(latest.current.activeStatement)),
    Prec.highest(
      keymap.of([
        {
          key: 'Mod-Enter',
          run: () => runQueryCommand(latest.current.onRunQuery)
        },
        {
          key: 'Mod-Shift-f',
          run: (view) => {
            runFormatCommand(view, latest.current.databaseType)

            return true
          }
        }
      ])
    )
  ]
}

// Reports whether the key was handled, so Mod-Enter falls through to whatever
// else wants it when no worksheet can run.
function runQueryCommand(onRunQuery: (() => void) | undefined): boolean {
  if (!onRunQuery) {
    return false
  }

  onRunQuery()

  return true
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

class ActiveStatementMarker extends GutterMarker {
  override elementClass = 'cm-activeStatementGutter'
}

const activeStatementMarker = new ActiveStatementMarker()

// Marks the gutter lines the active statement spans. Recomputed whenever the
// document changes, and rebuilt whenever the active statement moves — which is
// what the compartment swaps.
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
