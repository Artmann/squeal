import { act, fireEvent, screen } from '@testing-library/react'
import { ReactElement, useState } from 'react'
import invariant from 'tiny-invariant'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorksheetDto } from '@/glue/worksheets'

import { renderWithProviders } from '../test-utils'
import { useWorksheetAutosave } from './useWorksheetAutosave'

vi.mock('../api-client', () => ({
  apiClient: {
    getDatabases: vi.fn(async () => []),
    getQueries: vi.fn(async () => []),
    getWorksheets: vi.fn(async () => []),
    updateWorksheet: vi.fn()
  }
}))

import { apiClient } from '../api-client'

const first: WorksheetDto = {
  content: 'select 1',
  createdAt: 1,
  databaseId: null,
  id: 'ws-1',
  lastOpenedAt: null,
  name: 'First',
  sortOrder: null
}

const second: WorksheetDto = {
  ...first,
  id: 'ws-2',
  name: 'Second'
}

// The switch happens inside the probe rather than through `rerender`, because
// switching worksheets in the app is a state change under the same providers —
// and the hook's flush-on-change cleanup is what the late-resolution cases turn
// on.
function AutosaveProbe(): ReactElement {
  const [worksheetId, setWorksheetId] = useState(first.id)

  const { flushSave, hasSaveFailed, queueSave } =
    useWorksheetAutosave(worksheetId)

  return (
    <>
      <button
        onClick={() => queueSave(`edited ${worksheetId}`)}
        type="button"
      >
        edit
      </button>

      {/* Different content from `edit`: an update that changes nothing is not
          a save, so two clicks of the same button cannot put two saves in
          flight. */}
      <button
        onClick={() => queueSave(`edited ${worksheetId} again`)}
        type="button"
      >
        edit again
      </button>

      <button
        onClick={flushSave}
        type="button"
      >
        flush
      </button>

      <button
        onClick={() =>
          setWorksheetId(worksheetId === first.id ? second.id : first.id)
        }
        type="button"
      >
        switch
      </button>

      <output>{worksheetId}</output>
      <output>{hasSaveFailed ? 'save failed' : 'no failure'}</output>
    </>
  )
}

// The state before a worksheet is picked, which the probe above cannot reach.
function ClosedProbe(): ReactElement {
  const { hasSaveFailed } = useWorksheetAutosave(undefined)

  return <output>{hasSaveFailed ? 'save failed' : 'no failure'}</output>
}

function click(name: string): void {
  fireEvent.click(screen.getByRole('button', { name }))
}

async function renderProbe(): Promise<ReturnType<typeof renderWithProviders>> {
  const rendered = renderWithProviders(<AutosaveProbe />, {
    worksheets: [first, second]
  })

  // `AppShell` preloads the collections in the real app; without it the
  // collection has no rows and `update` throws instead of saving.
  await act(async () => {
    await rendered.collections.worksheets.preload()
  })

  return rendered
}

interface Settler {
  reject: (error: Error) => void
  resolve: (worksheet: WorksheetDto) => void
  settled: boolean
  worksheetId: string
}

interface DeferredSaves {
  fail: (worksheetId: string, position?: number) => Promise<void>
  succeed: (worksheetId: string, position?: number) => Promise<void>
}

/**
 * Saves that settle only when the test says so, which is the only way to place
 * a switch — or a whole second save — between a save being sent and its answer
 * coming back. `position` picks among the saves still in flight for that
 * worksheet, oldest first, so a test can answer them out of order.
 */
function deferredSaves(): DeferredSaves {
  const settlers: Settler[] = []

  vi.mocked(apiClient.updateWorksheet).mockImplementation(
    (worksheetId: string) =>
      new Promise<WorksheetDto>((resolve, reject) => {
        settlers.push({ reject, resolve, settled: false, worksheetId })
      })
  )

  function take(worksheetId: string, position: number): Settler {
    const settler = settlers.filter(
      (entry) => !entry.settled && entry.worksheetId === worksheetId
    )[position]

    invariant(
      settler,
      `No save is in flight for ${worksheetId} at position ${position}.`
    )

    settler.settled = true

    return settler
  }

  return {
    async fail(worksheetId: string, position = 0) {
      const settler = take(worksheetId, position)

      await act(async () => {
        settler.reject(new Error('The connection was lost.'))
      })
    },
    async succeed(worksheetId: string, position = 0) {
      const settler = take(worksheetId, position)

      await act(async () => {
        settler.resolve({ ...first, id: worksheetId })
      })
    }
  }
}

describe('useWorksheetAutosave', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(apiClient.updateWorksheet).mockImplementation(
      async (worksheetId: string) => ({ ...first, id: worksheetId })
    )
  })

  it('saves the edited content once the debounce elapses', async () => {
    await renderProbe()

    vi.useFakeTimers()

    try {
      click('edit')

      expect(apiClient.updateWorksheet).not.toHaveBeenCalled()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(300)
      })

      expect(vi.mocked(apiClient.updateWorksheet).mock.calls).toEqual([
        ['ws-1', { content: 'edited ws-1' }]
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  // The debounce is the reason a keystroke does not cost a request, so the hook
  // must still coalesce rather than save once per edit.
  it('coalesces rapid edits into one save', async () => {
    await renderProbe()

    vi.useFakeTimers()

    try {
      click('edit')
      click('edit')
      click('edit')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(300)
      })

      expect(vi.mocked(apiClient.updateWorksheet).mock.calls).toEqual([
        ['ws-1', { content: 'edited ws-1' }]
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  // Coalescing alone does not prove the window moves: three edits in the same
  // tick would collapse anyway once the first flush took the pending save. The
  // window has to restart from the last keystroke, or a steady typist is saved
  // on a fixed 300ms drumbeat instead of when they pause.
  it('restarts the debounce window on every edit', async () => {
    await renderProbe()

    vi.useFakeTimers()

    try {
      click('edit')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(200)
      })

      click('edit')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(200)
      })

      expect(apiClient.updateWorksheet).not.toHaveBeenCalled()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })

      expect(vi.mocked(apiClient.updateWorksheet).mock.calls).toEqual([
        ['ws-1', { content: 'edited ws-1' }]
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  // Running a query needs the saved copy to be current, so the caller can close
  // the debounce window instead of waiting it out.
  it('saves immediately when the caller flushes', async () => {
    await renderProbe()

    // Frozen time is the assertion: a save that shows up here can only have
    // come from the flush, because the debounce never elapses. Polling with
    // `waitFor` would let the 300ms window close on its own and pass against a
    // `flushSave` that did nothing at all.
    vi.useFakeTimers()

    try {
      click('edit')
      click('flush')

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })

      expect(vi.mocked(apiClient.updateWorksheet).mock.calls).toEqual([
        ['ws-1', { content: 'edited ws-1' }]
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  // Nothing is open before the first worksheet is picked, and "no worksheet"
  // must not read as "the worksheet that failed".
  it('reports no failure when no worksheet is open', () => {
    renderWithProviders(<ClosedProbe />)

    expect(screen.getByText('no failure')).toBeInTheDocument()
  })

  it('reports a save that failed', async () => {
    const saves = deferredSaves()

    await renderProbe()

    click('edit')
    click('flush')

    await saves.fail('ws-1')

    expect(screen.getByText('save failed')).toBeInTheDocument()
  })

  it('raises a toast when a save fails', async () => {
    const saves = deferredSaves()

    await renderProbe()

    click('edit')
    click('flush')

    await saves.fail('ws-1')

    expect(
      await screen.findByText('Failed to save worksheet')
    ).toBeInTheDocument()
  })

  // The old state carried no worksheet, so a failure in one worksheet kept
  // accusing whichever one you opened next.
  it('does not carry a failure over to the next worksheet', async () => {
    const saves = deferredSaves()

    await renderProbe()

    click('edit')
    click('flush')

    await saves.fail('ws-1')

    click('switch')

    expect({
      failure: screen.getByText('no failure').textContent,
      worksheet: screen.getByText('ws-2').textContent
    }).toEqual({ failure: 'no failure', worksheet: 'ws-2' })
  })

  // Switching flushes the previous worksheet's pending save, so its rejection
  // always lands after the switch. That is the failure the new worksheet must
  // not be blamed for.
  it('does not blame the new worksheet for the old one’s failed save', async () => {
    const saves = deferredSaves()

    await renderProbe()

    click('edit')
    click('switch')

    await saves.fail('ws-1')

    expect({
      failure: screen.getByText('no failure').textContent,
      worksheet: screen.getByText('ws-2').textContent
    }).toEqual({ failure: 'no failure', worksheet: 'ws-2' })
  })

  // The notice is about the save you just made. By the time you come back the
  // content it carried is gone — a failed persist rolls the collection back to
  // the server's copy, and nothing else keeps it — so a worksheet that still
  // said "Save failed" would be pointing at text that matches what is stored.
  it('forgets the failure once you come back to the worksheet', async () => {
    const saves = deferredSaves()

    await renderProbe()

    click('edit')
    click('flush')

    await saves.fail('ws-1')

    expect(screen.getByText('save failed')).toBeInTheDocument()

    click('switch')
    click('switch')

    expect({
      failure: screen.getByText('no failure').textContent,
      worksheet: screen.getByText('ws-1').textContent
    }).toEqual({ failure: 'no failure', worksheet: 'ws-1' })
  })

  // Two saves for one worksheet really do run at the same time: the second is
  // sent while the first is still open. If the first then fails, the content it
  // carried has already been stored by the second, and saying "Save failed"
  // would be a warning about nothing.
  it('does not re-raise a failure a newer save has already cleared', async () => {
    const saves = deferredSaves()

    await renderProbe()

    click('edit')
    click('flush')

    click('edit again')
    click('flush')

    await saves.succeed('ws-1', 1)
    await saves.fail('ws-1', 0)

    expect(screen.getByText('no failure')).toBeInTheDocument()
  })

  // The mirror of the case above, and the reason the answer to a save is
  // ignored by age rather than by outcome: an older save landing successfully
  // says nothing about the newer one that failed after it.
  it('keeps the failure when an older save for the same worksheet lands', async () => {
    const saves = deferredSaves()

    await renderProbe()

    click('edit')
    click('flush')

    click('edit again')
    click('flush')

    await saves.fail('ws-1', 1)
    await saves.succeed('ws-1', 0)

    expect(screen.getByText('save failed')).toBeInTheDocument()
  })

  // The status bar describes the worksheet on screen, so it says nothing about
  // one you have left. The toast is not tied to a worksheet, and a save that
  // did not happen is worth knowing about wherever you are.
  it('still raises a toast for a save that failed after you moved on', async () => {
    const saves = deferredSaves()

    await renderProbe()

    click('edit')
    click('switch')

    await saves.fail('ws-1')

    expect(
      await screen.findByText('Failed to save worksheet')
    ).toBeInTheDocument()
  })

  // Deleting a worksheet takes its row out of the collection and moves the app
  // to another one, both inside the debounce window. Updating a key that is
  // gone throws, and it throws out of the effect cleanup that flushes on the
  // way out — which unmounts the whole workspace.
  it('drops a pending save for a worksheet that has been deleted', async () => {
    const rendered = await renderProbe()

    click('edit')

    act(() => {
      rendered.collections.worksheets.utils.writeDelete(first.id)
    })

    click('switch')

    expect({
      calls: vi.mocked(apiClient.updateWorksheet).mock.calls,
      worksheet: screen.getByText('ws-2').textContent
    }).toEqual({ calls: [], worksheet: 'ws-2' })
  })

  // The mirror case: a save that succeeds clears the failure it belongs to and
  // no other. Age alone cannot decide this one — the successful save is the
  // newer of the two, and it still has nothing to say about the worksheet you
  // are looking at.
  it('keeps the failure when a different worksheet saves successfully', async () => {
    const saves = deferredSaves()

    await renderProbe()

    click('edit')
    click('flush')

    click('switch')
    click('edit')
    click('switch')

    await saves.fail('ws-1')

    expect(screen.getByText('save failed')).toBeInTheDocument()

    await saves.succeed('ws-2')

    expect(screen.getByText('save failed')).toBeInTheDocument()
  })

  it('clears the failure once the worksheet saves again', async () => {
    const saves = deferredSaves()

    await renderProbe()

    click('edit')
    click('flush')

    await saves.fail('ws-1')

    expect(screen.getByText('save failed')).toBeInTheDocument()

    click('edit')
    click('flush')

    await saves.succeed('ws-1')

    expect(screen.getByText('no failure')).toBeInTheDocument()
  })
})
