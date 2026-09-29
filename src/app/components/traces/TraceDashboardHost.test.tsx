import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { renderWithProviders } from '../../test-utils'
import { TraceDashboardHost } from './TraceDashboardHost'

describe('TraceDashboardHost', () => {
  it('does not open over the editor screen', async () => {
    const user = userEvent.setup()

    const { store } = renderWithProviders(<TraceDashboardHost />, {
      ui: { editorScreen: { type: 'create-database' } }
    })

    await user.keyboard('{Meta>}{Shift>}t{/Shift}{/Meta}')

    expect(store.getState().ui).toEqual({
      editorScreen: { type: 'create-database' }
    })
  })

  it('opens from the keyboard otherwise', async () => {
    const user = userEvent.setup()

    const { store } = renderWithProviders(<TraceDashboardHost />, {
      ui: {}
    })

    await user.keyboard('{Meta>}{Shift>}t{/Shift}{/Meta}')

    expect(store.getState().ui).toEqual({ traceDashboardOpen: true })
  })
})
