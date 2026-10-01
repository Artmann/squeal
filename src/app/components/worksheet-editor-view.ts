// Gives every worksheet its own caret, selection and scroll position, and keeps
// them across restarts.
//
// There is one editor for all the worksheets: switching tabs hands
// `@uiw/react-codemirror` a new `value`, and it replaces the whole document in
// a transaction annotated `ExternalChange`. Left alone, the new worksheet opens
// with the old one's caret mapped onto its text and the old one's scroll
// position. So the editor carries the id of the worksheet its document belongs
// to, in a state field, and moves it -- restoring that worksheet's selection in
// the same step, and its scroll position right after -- only when the document
// itself is swapped. That matters because
// the swap is not always immediate: while the user is typing, the library holds
// it back for a moment, and until it lands the document, the caret and the
// scroll position still belong to the worksheet being left.
import {
  EditorSelection,
  EditorState,
  type Extension,
  type SelectionRange,
  StateEffect,
  StateField,
  type Transaction,
  type TransactionSpec
} from '@codemirror/state'
import { EditorView, type ViewUpdate } from '@codemirror/view'
import { ExternalChange } from '@uiw/react-codemirror'

import {
  clampEditorView,
  readStoredEditorViews,
  rememberEditorView,
  type StoredEditorView,
  type StoredEditorViews,
  type StoredScroll,
  topOfDocument,
  writeStoredEditorViews
} from './worksheet-editor-view-storage'

// How long the view has to sit still before it is written down. Leaving the
// worksheet, closing the window and unmounting the editor all write straight
// away, so this only decides how much of a crash can be lost.
const saveDelay = 300

const bindWorksheet = StateEffect.define<string | undefined>()

/**
 * Reads the view a worksheet should come back to out of a live editor.
 *
 * The scroll position is the line at the top of the editor plus how far the
 * editor is scrolled past that line's top edge, so it is `scrollTop` again
 * exactly when the lines above keep their heights, and still the same line when
 * they do not.
 */
function captureEditorView(view: EditorView): StoredEditorView {
  const { mainIndex, ranges } = view.state.selection

  // Asking for a line block first makes CodeMirror run any measure it has
  // scheduled, and a measure can move the scroll position -- so `scrollTop` is
  // read after it, not before.
  view.lineBlockAtHeight(0)

  const scrollTop = view.scrollDOM.scrollTop

  const line = view.lineBlockAtHeight(
    Math.max(0, scrollTop - view.documentPadding.top)
  )

  return {
    main: mainIndex,
    ranges: ranges.map((range) => ({ anchor: range.anchor, head: range.head })),
    scroll: { offset: scrollTop - line.top, position: line.from }
  }
}

function toEditorSelection(view: StoredEditorView): EditorSelection {
  return EditorSelection.create(
    view.ranges.map((range) => EditorSelection.range(range.anchor, range.head)),
    view.main
  )
}

/**
 * One editor's memory of where each worksheet was left. Built once per editor,
 * with the extension it installs; `attach` is handed the view when it is
 * created, and `saveNow` is called whenever the view has to be written down
 * before it changes.
 */
export class WorksheetViewMemory {
  readonly extension: Extension

  private readonly boundWorksheet: StateField<string | undefined>
  // A restored scroll position that has not been applied yet. CodeMirror can
  // only scroll once it has measured the new document, a frame later, and
  // until then the editor's own `scrollTop` still describes the worksheet that
  // left -- so a save in between reports this instead.
  private pendingScroll: StoredScroll | null = null
  private saveTimer: ReturnType<typeof setTimeout> | undefined
  private view: EditorView | undefined
  // Bounded by `rememberEditorView`, and owned by this editor rather than the
  // module, so it goes when the editor does.
  private readonly views: StoredEditorViews

  constructor(getWorksheetId: () => string | undefined) {
    this.views = readStoredEditorViews()

    this.boundWorksheet = StateField.define<string | undefined>({
      create: () => getWorksheetId(),
      update: (worksheetId, transaction) => {
        for (const effect of transaction.effects) {
          if (effect.is(bindWorksheet)) {
            return effect.value
          }
        }

        return worksheetId
      }
    })

    this.extension = [
      this.boundWorksheet,
      EditorState.transactionFilter.of((transaction) =>
        this.restoreOnSwap(transaction, getWorksheetId())
      ),
      EditorView.updateListener.of((update) => {
        this.handleUpdate(update)
      }),
      EditorView.domEventObservers({
        scroll: (_event, view) => {
          this.scheduleSave(view)
        }
      }),
      EditorView.scrollHandler.of((view, range) =>
        this.applyPendingScroll(view, range)
      )
    ]
  }

  /**
   * Restores the view of the worksheet the editor was created for -- the one
   * that was open when the app last closed, or the one reopened after every tab
   * was closed.
   */
  attach(view: EditorView): void {
    this.view = view

    const worksheetId = view.state.field(this.boundWorksheet, false)

    if (!worksheetId || !this.views.has(worksheetId)) {
      return
    }

    const restored = this.recall(worksheetId, view.state.doc.length)

    this.pendingScroll = restored.scroll

    view.dispatch({
      effects: EditorView.scrollIntoView(restored.scroll.position),
      selection: toEditorSelection(restored)
    })
  }

  /**
   * Moves the editor to another worksheet when there was no document to swap:
   * two worksheets with the same content, most often both empty. The library
   * only dispatches when the text differs, so without this the second one would
   * go on writing its caret under the first one's id.
   *
   * Does nothing while a swap is still on its way, because then the document is
   * not `content` yet.
   */
  follow(worksheetId: string | undefined, content: string): void {
    const view = this.view

    if (!view || view.state.field(this.boundWorksheet, false) === worksheetId) {
      return
    }

    if (view.state.doc.toString() !== content) {
      return
    }

    this.saveNow()

    const restored = this.recall(worksheetId, view.state.doc.length)

    // The scroll follows from `handleUpdate`, as it does after a swap.
    view.dispatch({
      effects: bindWorksheet.of(worksheetId),
      selection: toEditorSelection(restored)
    })
  }

  /** Writes the view down one last time and lets go of the editor. */
  release(): void {
    this.saveNow()
    this.view = undefined
  }

  /** Writes the current worksheet's view down now, rather than after the delay. */
  saveNow(): void {
    this.cancelSave()

    if (this.view) {
      this.save(this.view)
    }
  }

  private applyPendingScroll(view: EditorView, range: SelectionRange): boolean {
    const scroll = this.pendingScroll

    // Whatever scroll request comes next uses the pending one up, ours or not:
    // CodeMirror applies one per measure, the latest, so a pending position
    // that is not the one asked for has already been overtaken.
    this.pendingScroll = null

    if (!scroll || range.head !== scroll.position) {
      return false
    }

    // Done here rather than handed back to CodeMirror, whose own scrolling
    // lines up the caret's rectangle -- a pixel or two below the line's top --
    // and would creep the view down a little on every switch.
    //
    // Measured from the line's element rather than from `lineBlockAt`: by now
    // the line is drawn, but every line above it still has an estimated
    // height, and in the running app that estimate put a worksheet scrolled to
    // line 95 back at line 60.
    const lineElement = findLineElement(view, scroll.position)

    if (!lineElement) {
      view.scrollDOM.scrollTop =
        view.lineBlockAt(scroll.position).top + scroll.offset

      return true
    }

    // `offset` is `scrollTop` minus the line's top, and the line's top sits
    // `documentPadding.top` below the top of the scrolled content, so this is
    // where on screen the line was when the view was saved.
    const wantedTop =
      view.scrollDOM.getBoundingClientRect().top +
      view.documentPadding.top -
      scroll.offset

    view.scrollDOM.scrollTop +=
      lineElement.getBoundingClientRect().top - wantedTop

    return true
  }

  private cancelSave(): void {
    if (this.saveTimer !== undefined) {
      clearTimeout(this.saveTimer)
      this.saveTimer = undefined
    }
  }

  private handleUpdate(update: ViewUpdate): void {
    this.view = update.view

    const worksheetId = update.state.field(this.boundWorksheet, false)

    if (worksheetId !== update.startState.field(this.boundWorksheet, false)) {
      this.requestScroll(
        update.view,
        this.recall(worksheetId, update.state.doc.length).scroll
      )

      return
    }

    if (update.selectionSet) {
      this.scheduleSave(update.view)
    }
  }

  // The stored view fitted to the document, or the top of it for a worksheet
  // with nothing stored.
  private recall(
    worksheetId: string | undefined,
    documentLength: number
  ): StoredEditorView {
    const stored = worksheetId ? this.views.get(worksheetId) : undefined

    if (!stored) {
      return {
        main: 0,
        ranges: [{ anchor: 0, head: 0 }],
        scroll: topOfDocument
      }
    }

    return clampEditorView(stored, documentLength)
  }

  // Asks CodeMirror to scroll in a transaction of its own, a moment after the
  // one that moved the worksheet. Carried in the swap itself, the request is
  // cut to the length of the document being replaced -- `EditorView.update`
  // clips it against the old state -- so a long worksheet coming back after a
  // short one would be scrolled to the wrong place.
  private requestScroll(view: EditorView, scroll: StoredScroll): void {
    this.pendingScroll = scroll

    queueMicrotask(() => {
      // Overtaken by another switch before it got here, which asks for its
      // own scroll.
      if (this.pendingScroll !== scroll) {
        return
      }

      view.dispatch({ effects: EditorView.scrollIntoView(scroll.position) })
    })
  }

  // Runs before a transaction is applied, so the swap and the restore are one
  // step: nothing ever sees the new document with the old worksheet's caret.
  private restoreOnSwap(
    transaction: Transaction,
    worksheetId: string | undefined
  ): Transaction | readonly (Transaction | TransactionSpec)[] {
    if (!transaction.docChanged || !transaction.annotation(ExternalChange)) {
      return transaction
    }

    if (
      worksheetId === transaction.startState.field(this.boundWorksheet, false)
    ) {
      return transaction
    }

    const restored = this.recall(worksheetId, transaction.newDoc.length)

    return [
      transaction,
      {
        effects: bindWorksheet.of(worksheetId),
        selection: toEditorSelection(restored),
        sequential: true
      }
    ]
  }

  private save(view: EditorView): void {
    const worksheetId = view.state.field(this.boundWorksheet, false)

    // A destroyed editor reads as scrolled to the top, which is not where the
    // user left it.
    if (!worksheetId || !view.dom.isConnected) {
      return
    }

    // Read before capturing: capturing can run a measure CodeMirror had
    // scheduled, and that measure is what applies -- and clears -- a pending
    // restore.
    const pendingScroll = this.pendingScroll
    const captured = captureEditorView(view)

    rememberEditorView(this.views, worksheetId, {
      ...captured,
      scroll: pendingScroll ?? captured.scroll
    })

    writeStoredEditorViews(this.views)
  }

  private scheduleSave(view: EditorView): void {
    this.view = view
    this.cancelSave()

    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined
      this.save(view)
    }, saveDelay)
  }
}

// The drawn element of the line holding `position`, or nothing when that line
// is not drawn -- folded away, or outside the viewport.
function findLineElement(view: EditorView, position: number): Element | null {
  const { node, offset } = view.domAtPos(position)

  // Between two lines the answer can be the content element itself, with the
  // line as the child at `offset`.
  const candidate =
    node === view.contentDOM ? view.contentDOM.childNodes.item(offset) : node

  const element =
    candidate instanceof Element ? candidate : candidate?.parentElement

  return element?.closest('.cm-line') ?? null
}
