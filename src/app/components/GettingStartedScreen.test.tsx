import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { renderWithProviders } from '../test-utils'
import { GettingStartedScreen } from './GettingStartedScreen'

// Form submission and validation behaviour is covered by DatabaseForm.test.tsx.
// These tests only verify the getting-started wrapper renders the form.
describe('GettingStartedScreen', () => {
  it('renders the welcome copy', () => {
    renderWithProviders(<GettingStartedScreen />)

    expect(screen.getByText('Connect a database')).toBeInTheDocument()
    expect(screen.getByText(/built for humans/)).toBeInTheDocument()
  })

  it('renders the database form fields', () => {
    renderWithProviders(<GettingStartedScreen />)

    expect(screen.getByLabelText('Name')).toBeInTheDocument()
    expect(screen.getByLabelText('Host')).toBeInTheDocument()
    expect(screen.getByLabelText('Port')).toBeInTheDocument()
    expect(screen.getByLabelText('Username')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByLabelText('Database')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('is a region named by its heading rather than a dialog', () => {
    renderWithProviders(<GettingStartedScreen />)

    expect(
      screen.getByRole('region', { name: 'Connect a database' })
    ).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('stays up on Escape', async () => {
    const user = userEvent.setup()

    const { store } = renderWithProviders(<GettingStartedScreen />)

    // Dismissing is persisted, so a stray key must not skip first-run setup.
    await user.click(screen.getByLabelText('Name'))
    await user.keyboard('{Escape}')

    expect(store.getState().ui).toEqual({})
  })

  it.each(['Close', 'Skip for now'])(
    'dismisses the screen from %s',
    async (name) => {
      const user = userEvent.setup()

      const { store } = renderWithProviders(<GettingStartedScreen />)

      await user.click(screen.getByRole('button', { name }))

      expect(store.getState().ui.gettingStartedDismissed).toEqual(true)
    }
  )
})
