import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { SearchInput } from './SearchInput'

describe('SearchInput', () => {
  it('renders an input with placeholder', () => {
    render(<SearchInput value="" onChange={vi.fn()} />)

    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument()
  })

  it('displays the provided value', () => {
    render(<SearchInput value="test query" onChange={vi.fn()} />)

    expect(screen.getByDisplayValue('test query')).toBeInTheDocument()
  })

  it('calls onChange with new value when user types', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<SearchInput value="" onChange={onChange} />)

    await user.type(screen.getByPlaceholderText('Search...'), 'hello')

    expect(onChange).toHaveBeenCalledTimes(5)
    expect(onChange).toHaveBeenLastCalledWith('o')
  })

  it('applies custom className to the input', () => {
    render(<SearchInput value="" onChange={vi.fn()} className="custom-class" />)

    expect(screen.getByPlaceholderText('Search...')).toHaveClass('custom-class')
  })

  it('renders search icon', () => {
    const { container } = render(<SearchInput value="" onChange={vi.fn()} />)

    expect(container.querySelector('svg')).toBeInTheDocument()
  })
})
