import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
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

  // Find opens on a shortcut and has to be ready for the paste that follows,
  // so its caller needs a handle on the element rather than a click to wait for.
  it('hands the input element back through inputRef', () => {
    const inputRef = createRef<HTMLInputElement>()

    render(
      <SearchInput
        inputRef={inputRef}
        placeholder="Find in results"
        value=""
        onChange={vi.fn()}
      />
    )

    expect(inputRef.current).toEqual(
      screen.getByPlaceholderText('Find in results')
    )
  })

  it('forwards key presses, which is how Enter and Escape are handled', async () => {
    const user = userEvent.setup()
    const onKeyDown = vi.fn()

    render(
      <SearchInput
        placeholder="Find in results"
        value=""
        onChange={vi.fn()}
        onKeyDown={onKeyDown}
      />
    )

    await user.type(screen.getByPlaceholderText('Find in results'), '{Enter}')

    expect(onKeyDown).toHaveBeenCalledTimes(1)
    expect(onKeyDown.mock.calls[0][0]).toMatchObject({ key: 'Enter' })
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
