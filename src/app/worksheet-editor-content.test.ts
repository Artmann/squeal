import { describe, expect, it } from 'vitest'

import type { WorksheetDto } from '@/glue/worksheets'
import { resolveEditorContent } from './worksheet-editor-content'

function worksheet(id: string, content: string): WorksheetDto {
  return {
    content,
    createdAt: 1,
    databaseId: null,
    id,
    lastOpenedAt: null,
    name: id,
    sortOrder: 0
  }
}

describe('resolveEditorContent', () => {
  it('falls back to the saved content before anything is typed', () => {
    expect(
      resolveEditorContent(null, 'ws-1', worksheet('ws-1', 'SELECT 1;'))
    ).toEqual('SELECT 1;')
  })

  it('prefers the edit still sitting in the autosave debounce', () => {
    expect(
      resolveEditorContent(
        { content: 'SELECT 2;', worksheetId: 'ws-1' },
        'ws-1',
        worksheet('ws-1', 'SELECT 1;')
      )
    ).toEqual('SELECT 2;')
  })

  // Switching tabs must not carry the previous worksheet's text across, which
  // is why the edit records the worksheet it belongs to.
  it('ignores an edit belonging to another worksheet', () => {
    expect(
      resolveEditorContent(
        { content: 'SELECT 2;', worksheetId: 'ws-1' },
        'ws-2',
        worksheet('ws-2', 'SELECT 3;')
      )
    ).toEqual('SELECT 3;')
  })

  it('answers an empty string when no worksheet is open', () => {
    expect(resolveEditorContent(null, undefined, undefined)).toEqual('')
  })
})
