import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { SearchInput } from './SearchInput'

describe('SearchInput', () => {
  it('renders an input with the given placeholder', () => {
    render(
      <SearchInput
        placeholder="Filter worksheets"
        value=""
        onChange={vi.fn()}
      />
    )

    expect(screen.getByPlaceholderText('Filter worksheets')).toBeInTheDocument()
  })

  it('displays the provided value', () => {
    render(
      <SearchInput
        placeholder="Filter tables"
        value="test query"
        onChange={vi.fn()}
      />
    )

    expect(screen.getByDisplayValue('test query')).toBeInTheDocument()
  })

  it('calls onChange with new value when user types', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <SearchInput
        placeholder="Filter tables"
        value=""
        onChange={onChange}
      />
    )

    await user.type(screen.getByPlaceholderText('Filter tables'), 'hello')

    expect(onChange).toHaveBeenCalledTimes(5)
    expect(onChange).toHaveBeenLastCalledWith('o')
  })

  it('applies custom className to the input', () => {
    render(
      <SearchInput
        value=""
        onChange={vi.fn()}
        className="custom-class"
        placeholder="Filter tables"
      />
    )

    expect(screen.getByPlaceholderText('Filter tables')).toHaveClass(
      'custom-class'
    )
  })

  it('renders search icon', () => {
    const { container } = render(
      <SearchInput
        placeholder="Filter tables"
        value=""
        onChange={vi.fn()}
      />
    )

    expect(container.querySelector('svg')).toBeInTheDocument()
  })
})
