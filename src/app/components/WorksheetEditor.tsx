import { sql } from '@codemirror/lang-sql'
import { Compartment, Prec, RangeSetBuilder } from '@codemirror/state'
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
import { apiClient } from '../api-client'
import { useDatabaseSchema, useSettings } from '../hooks/queries'
import { type Statement } from '../sql-parser'
import { squealEditorTheme, squealHighlighting } from './codemirror-theme'
import { toEditorDialect, toSqlNamespace } from './sql-schema-completion'
import { formatEditorContent } from './worksheet-editor-format'
import {
  type CursorPosition,
  isSameCursorPosition,
  toCursorPosition
} from './worksheet-editor-cursor'
import {
  acceptGhostText,
  acceptGhostTextWord,
  dismissGhostText,
  ghostText
} from './worksheet-editor-ghost-text'
import { findGutterMarkerPositions } from './worksheet-editor-lines'

export interface WorksheetEditorProps {
  activeStatementIndex: number | null
  content: string
  databaseId?: string
  databaseType?: DatabaseType
  statements: Statement[]
  onChange?: (value: string) => void
  onCursorChange?: (position: CursorPosition) => void
  onCursorPositionChange?: (position: number) => void
  onRunQuery?: () => void
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
  databaseId,
  databaseType,
  statements,
  onChange,
  onCursorChange,
  onCursorPositionChange,
  onRunQuery
}: WorksheetEditorProps): ReactElement {
  // Already in the cache — the sidebar prefetches every database's schema — so
  // this is a read rather than a request.
  const schema = useDatabaseSchema(databaseId)
  const settings = useSettings()

  const databaseIdRef = useRef(databaseId)
  const databaseTypeRef = useRef(databaseType)
  const editorRef = useRef<ReactCodeMirrorRef>(null)
  const lastCursorPositionRef = useRef<CursorPosition | null>(null)
  const onRunQueryRef = useRef(onRunQuery)
  const suggestionsEnabledRef = useRef(false)

  // The keymap is built once, so it reads the current props through refs
  // rather than being rebuilt on every change. Syncing them in an effect
  // rather than during render keeps the render pure; the keymap only fires on
  // user input, which is always after the effect has run.
  useEffect(() => {
    databaseIdRef.current = databaseId
    databaseTypeRef.current = databaseType
    onRunQueryRef.current = onRunQuery
    // Off until the settings have loaded: a suggestion the user turned off must
    // never appear, not even once.
    suggestionsEnabledRef.current = settings.data?.aiCompletionsEnabled ?? false
  })

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

  const handleUpdate = useCallback(
    (update: ViewUpdate) => {
      const offset = update.state.selection.main.head
      const position = toCursorPosition(update.state.doc.lineAt(offset), offset)

      if (isSameCursorPosition(lastCursorPositionRef.current, position)) {
        return
      }

      lastCursorPositionRef.current = position

      onCursorPositionChange?.(position.offset)
      onCursorChange?.(position)
    },
    [onCursorChange, onCursorPositionChange]
  )

  // The language extension changes whenever the worksheet's database or its
  // schema does. It lives in a compartment so those reconfigurations do not
  // rebuild the whole extension array, which would throw away the ghost text
  // state field along with everything else.
  const sqlCompartment = useMemo(() => new Compartment(), [])

  const sqlExtension = useMemo(
    () =>
      sql({
        dialect: toEditorDialect(databaseType),
        upperCaseKeywords: true,
        ...(schema.data === undefined
          ? {}
          : { schema: toSqlNamespace(schema.data) })
      }),
    [databaseType, schema.data]
  )

  useEffect(() => {
    const view = editorRef.current?.view

    if (!view) {
      return
    }

    view.dispatch({ effects: sqlCompartment.reconfigure(sqlExtension) })
  }, [sqlCompartment, sqlExtension])

  const extensions = useMemo(() => {
    return [
      squealEditorTheme,
      squealHighlighting,
      // Filled in by the effect above, which runs right after mount. Starting
      // empty keeps this array free of props, so it is built exactly once.
      sqlCompartment.of([]),
      EditorView.lineWrapping,
      // `autocompletion()` is not registered here: basicSetup already adds it,
      // and a second one would open two dropdowns.
      ghostText({
        fetchSuggestion: async (request, signal) => {
          const currentDatabaseId = databaseIdRef.current

          const response = await apiClient.createCompletion(
            {
              ...(currentDatabaseId === undefined
                ? {}
                : { databaseId: currentDatabaseId }),
              ...request
            },
            signal
          )

          return response.completion
        },
        isEnabled: () => suggestionsEnabledRef.current
      }),
      Prec.highest(
        keymap.of([
          // These sit at the highest precedence because they have to win
          // against bindings CodeMirror registers first: `Escape` against the
          // dropdown's own close, and `Tab` against indentWithTab, which
          // @uiw/react-codemirror unshifts ahead of these extensions. Each
          // command returns false when no suggestion is showing, so the
          // original binding still runs.
          {
            key: 'Escape',
            run: dismissGhostText
          },
          {
            key: 'Mod-ArrowRight',
            run: acceptGhostTextWord
          },
          {
            key: 'Tab',
            run: acceptGhostText
          },
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
  }, [sqlCompartment])

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
