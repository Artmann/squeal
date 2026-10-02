import { describe, expect, it } from 'vitest'

import { makeWorksheet } from './test-fixtures'
import { resolveEditorContent } from './worksheet-editor-content'

describe('resolveEditorContent', () => {
  it('falls back to the saved content before anything is typed', () => {
    expect(
      resolveEditorContent(
        null,
        'ws-1',
        makeWorksheet({ content: 'SELECT 1;', id: 'ws-1' })
      )
    ).toEqual('SELECT 1;')
  })

  it('prefers the edit still sitting in the autosave debounce', () => {
    expect(
      resolveEditorContent(
        { content: 'SELECT 2;', worksheetId: 'ws-1' },
        'ws-1',
        makeWorksheet({ content: 'SELECT 1;', id: 'ws-1' })
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
        makeWorksheet({ content: 'SELECT 3;', id: 'ws-2' })
      )
    ).toEqual('SELECT 3;')
  })

  it('answers an empty string when no worksheet is open', () => {
    expect(resolveEditorContent(null, undefined, undefined)).toEqual('')
  })
})
