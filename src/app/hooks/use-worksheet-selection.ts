import { useAppDispatch, useAppSelector } from '../store'
import {
  extendSelection,
  pruneSelection,
  replaceSelection,
  toggleSelection
} from '../list-selection'
import { worksheetSelectionChanged } from '../store/editor-slice'
import { selectActiveWorksheetId } from '../store/tabs-slice'

interface WorksheetSelection {
  /** The selected rows, in list order. Never empty while a worksheet is open. */
  ids: string[]
  /** Shift-click: the range from the anchor to this row. */
  extend: (worksheetId: string) => void
  isSelected: (worksheetId: string) => boolean
  /** A plain click: this row alone. */
  replace: (worksheetId: string) => void
  /** Command- or control-click: this row in or out of the selection. */
  toggle: (worksheetId: string) => void
}

/**
 * The worksheets the sidebar acts on together — what a drag carries and what a
 * delete takes with it.
 *
 * Two things are resolved here rather than in the store, because both depend on
 * the list rather than on the selection itself:
 *
 * - rows that have gone are dropped, so a worksheet deleted in this window or
 *   another one cannot leave an id behind for a later drag to move;
 * - with nothing picked out, the open worksheet stands in for the selection.
 *   It is the row the user is on, so a command-click has to add to it rather
 *   than replace it — otherwise the first modified click silently drops the
 *   row you were working in.
 *
 * `orderedIds` is the whole worksheet list, not the filtered rows: a range is
 * measured over the order the rows really sit in.
 */
export function useWorksheetSelection(
  orderedIds: string[]
): WorksheetSelection {
  const dispatch = useAppDispatch()
  const openWorksheetId = useAppSelector(selectActiveWorksheetId)
  const storedSelection = useAppSelector(
    (state) => state.editor.worksheetSelection
  )

  const pruned = pruneSelection(storedSelection, orderedIds)
  const selection =
    pruned ??
    (openWorksheetId && orderedIds.includes(openWorksheetId)
      ? replaceSelection(openWorksheetId)
      : null)

  const selected = new Set(selection?.ids ?? [])

  return {
    extend: (worksheetId) => {
      dispatch(
        worksheetSelectionChanged(
          extendSelection(selection, worksheetId, orderedIds)
        )
      )
    },
    // Read off the list rather than the selection, so the order a drag and a
    // delete see is the order on screen and not the order rows were clicked.
    ids: orderedIds.filter((id) => selected.has(id)),
    isSelected: (worksheetId) => selected.has(worksheetId),
    replace: (worksheetId) => {
      dispatch(worksheetSelectionChanged(replaceSelection(worksheetId)))
    },
    toggle: (worksheetId) => {
      dispatch(
        worksheetSelectionChanged(toggleSelection(selection, worksheetId))
      )
    }
  }
}
