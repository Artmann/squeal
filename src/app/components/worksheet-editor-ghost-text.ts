// Copilot-style inline suggestions: after a pause in typing, the rest of the
// statement appears in grey at the cursor, and Tab accepts it.
//
// The state lives in a StateField so the decoration, the commands, and the
// tests all read the same value; the ViewPlugin only owns the things that need
// cleaning up — the debounce timer and the AbortController for the request in
// flight.
import { completionStatus } from '@codemirror/autocomplete'
import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type TransactionSpec
} from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate
} from '@codemirror/view'

import { maxCompletionContext } from '@/glue/api/schemas'

export const ghostTextDebounceMilliseconds = 350

export interface GhostSuggestion {
  /** Document offset the suggestion continues from. */
  from: number
  text: string
}

export interface GhostTextRequest {
  prefix: string
  suffix: string
}

export interface GhostTextConfig {
  /**
   * Answers with the rest of the statement, or null when there is nothing to
   * suggest. It must never reject with anything the user should see: a
   * suggestion that did not arrive is not an error.
   */
  fetchSuggestion: (
    request: GhostTextRequest,
    signal: AbortSignal
  ) => Promise<string | null>
  isEnabled: () => boolean
}

// Only what the commands touch. A bare state+dispatch pair satisfies it, which
// keeps the tests off a real EditorView — jsdom cannot measure one.
export interface GhostTextTarget {
  // Rest-typed to match `EditorView.dispatch`'s overloads; the commands only
  // ever pass a single spec.
  dispatch: (...specs: TransactionSpec[]) => void
  state: EditorState
}

export const setGhostText = StateEffect.define<GhostSuggestion>()
export const clearGhostText = StateEffect.define<null>()

// Dismissal is its own effect so the plugin can tell "the user pressed Esc"
// apart from "the suggestion no longer applies" and drop the request that is
// still in flight.
export const dismissedGhostText = StateEffect.define<null>()

function toDecorations(suggestion: GhostSuggestion | null): DecorationSet {
  if (suggestion === null) {
    return Decoration.none
  }

  return Decoration.set([
    Decoration.widget({
      // Right of the cursor, so the caret stays where the user left it.
      side: 1,
      widget: new GhostTextWidget(suggestion.text)
    }).range(suggestion.from)
  ])
}

export const ghostTextField = StateField.define<GhostSuggestion | null>({
  create: () => null,
  provide: (field) => EditorView.decorations.from(field, toDecorations),
  update: (suggestion, transaction) => {
    for (const effect of transaction.effects) {
      if (effect.is(setGhostText)) {
        return effect.value
      }

      if (effect.is(clearGhostText) || effect.is(dismissedGhostText)) {
        return null
      }
    }

    if (suggestion === null) {
      return null
    }

    // Any edit invalidates it: the text it continued from is gone.
    if (transaction.docChanged) {
      return null
    }

    const cursor = transaction.state.selection.main

    // The suggestion only makes sense at the point it was made for.
    if (!cursor.empty || cursor.head !== suggestion.from) {
      return null
    }

    return suggestion
  }
})

/** The leading whitespace plus one word, for Mod-→. */
export function firstSuggestionWord(text: string): string {
  const match = /^\s*(?:[A-Za-z0-9_$]+|[^A-Za-z0-9_$\s])/.exec(text)

  return match === null ? text : match[0]
}

export function acceptGhostText(view: GhostTextTarget): boolean {
  const suggestion = view.state.field(ghostTextField, false)

  if (!suggestion) {
    return false
  }

  view.dispatch({
    changes: { from: suggestion.from, insert: suggestion.text },
    effects: clearGhostText.of(null),
    scrollIntoView: true,
    selection: { anchor: suggestion.from + suggestion.text.length },
    userEvent: 'input.complete'
  })

  return true
}

export function acceptGhostTextWord(view: GhostTextTarget): boolean {
  const suggestion = view.state.field(ghostTextField, false)

  if (!suggestion) {
    return false
  }

  const word = firstSuggestionWord(suggestion.text)
  const rest = suggestion.text.slice(word.length)
  const cursor = suggestion.from + word.length

  view.dispatch({
    changes: { from: suggestion.from, insert: word },
    // The rest keeps showing, anchored at where the cursor lands. Setting it in
    // the same transaction beats the field's invalidate-on-edit rule, which is
    // what the effect ordering in `update` is for.
    effects:
      rest.length === 0
        ? clearGhostText.of(null)
        : setGhostText.of({ from: cursor, text: rest }),
    scrollIntoView: true,
    selection: { anchor: cursor },
    userEvent: 'input.complete'
  })

  return true
}

export function dismissGhostText(view: GhostTextTarget): boolean {
  if (!view.state.field(ghostTextField, false)) {
    return false
  }

  view.dispatch({ effects: dismissedGhostText.of(null) })

  return true
}

/**
 * Whether the cursor is somewhere a suggestion would help. Nothing is asked for
 * while text is selected, while the completion dropdown is open, or when the
 * cursor sits before existing text on the line — a suggestion would be drawn
 * over it.
 */
export function shouldRequestSuggestion(state: EditorState): boolean {
  const cursor = state.selection.main

  if (!cursor.empty) {
    return false
  }

  if (completionStatus(state) === 'active') {
    return false
  }

  const line = state.doc.lineAt(cursor.head)

  if (state.sliceDoc(cursor.head, line.to).trim().length > 0) {
    return false
  }

  // Nothing to continue from yet.
  return state.sliceDoc(0, cursor.head).trim().length > 0
}

class GhostTextWidget extends WidgetType {
  constructor(readonly text: string) {
    super()
  }

  override eq(other: GhostTextWidget): boolean {
    return other.text === this.text
  }

  // Clicks land in the document underneath rather than being swallowed.
  override ignoreEvent(): boolean {
    return false
  }

  override toDOM(): HTMLElement {
    const element = document.createElement('span')

    element.className = 'cm-ghostText'
    element.textContent = this.text

    return element
  }
}

function isDismissal(update: ViewUpdate): boolean {
  return update.transactions.some((transaction) =>
    transaction.effects.some((effect) => effect.is(dismissedGhostText))
  )
}

function makeGhostTextPlugin(config: GhostTextConfig) {
  return ViewPlugin.fromClass(
    class {
      private controller: AbortController | null = null
      private generation = 0
      private timer: ReturnType<typeof setTimeout> | null = null
      private readonly view: EditorView

      constructor(view: EditorView) {
        this.view = view
      }

      destroy(): void {
        this.cancel()
      }

      update(update: ViewUpdate): void {
        // Esc means "not now": drop the pending request too, or it would draw
        // the suggestion back a moment later.
        if (isDismissal(update)) {
          this.cancel()

          return
        }

        // Only typing asks for a suggestion. Moving the cursor around a
        // finished statement should be quiet — but it does abandon whatever
        // was already on its way.
        if (!update.docChanged) {
          if (update.selectionSet) {
            this.cancel()
          }

          return
        }

        this.cancel()

        if (!config.isEnabled()) {
          return
        }

        this.timer = setTimeout(() => {
          this.timer = null

          void this.request()
        }, ghostTextDebounceMilliseconds)
      }

      // Clears both the pending timer and the request in flight, and moves the
      // generation on so a reply already on its way is ignored.
      private cancel(): void {
        this.generation++

        if (this.timer !== null) {
          clearTimeout(this.timer)

          this.timer = null
        }

        if (this.controller !== null) {
          this.controller.abort()

          this.controller = null
        }
      }

      private async request(): Promise<void> {
        const state = this.view.state

        if (!config.isEnabled() || !shouldRequestSuggestion(state)) {
          return
        }

        const cursor = state.selection.main.head
        const document = state.doc
        const controller = new AbortController()
        const generation = ++this.generation

        this.controller = controller

        try {
          const suggestion = await config.fetchSuggestion(
            {
              // Bounded to what one request may carry, so a long worksheet is
              // truncated here rather than rejected by the contract.
              prefix: state.sliceDoc(
                Math.max(0, cursor - maxCompletionContext),
                cursor
              ),
              suffix: state.sliceDoc(
                cursor,
                Math.min(document.length, cursor + maxCompletionContext)
              )
            },
            controller.signal
          )

          if (generation !== this.generation || suggestion === null) {
            return
          }

          // The user kept typing, or moved on, while the model was thinking.
          if (
            !this.view.state.doc.eq(document) ||
            this.view.state.selection.main.head !== cursor
          ) {
            return
          }

          this.view.dispatch({
            effects: setGhostText.of({ from: cursor, text: suggestion })
          })
        } catch {
          // A suggestion that did not arrive shows nothing at all. The server
          // logged whatever went wrong.
        } finally {
          if (this.controller === controller) {
            this.controller = null
          }
        }
      }
    }
  )
}

export function ghostText(config: GhostTextConfig): Extension {
  return [ghostTextField, makeGhostTextPlugin(config)]
}
