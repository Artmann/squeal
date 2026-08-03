import type { WorksheetDto } from '@/glue/worksheets'

export interface EditedContent {
  content: string
  worksheetId: string
}

/**
 * The text the editor is showing right now. Autosave only catches the saved
 * copy up after its debounce, so anything derived from the worksheet row — the
 * statement list, and with it the statement a run executes — would be a moment
 * behind what the user can see.
 *
 * The edit is tagged with the worksheet it came from, so opening another
 * worksheet falls back to that worksheet's saved content instead of showing the
 * previous one's text.
 */
export function resolveEditorContent(
  editedContent: EditedContent | null,
  openWorksheetId: string | undefined,
  currentWorksheet: WorksheetDto | undefined
): string {
  if (editedContent && editedContent.worksheetId === openWorksheetId) {
    return editedContent.content
  }

  return currentWorksheet?.content ?? ''
}
