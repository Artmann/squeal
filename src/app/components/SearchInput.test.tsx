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

  it('shows no clear button while the input is empty', () => {
    render(
      <SearchInput
        placeholder="Filter tables"
        value=""
        onChange={vi.fn()}
      />
    )

    expect(
      screen.queryByRole('button', { name: 'Clear search' })
    ).not.toBeInTheDocument()
  })

  it('clears the input and focuses it again when the clear button is clicked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <SearchInput
        placeholder="Filter tables"
        value="actor"
        onChange={onChange}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Clear search' }))

    expect(onChange.mock.calls).toEqual([['']])
    expect(screen.getByPlaceholderText('Filter tables')).toHaveFocus()
  })

  it('focuses the caller’s input ref when the clear button is clicked', async () => {
    const user = userEvent.setup()
    const inputRef = createRef<HTMLInputElement>()

    render(
      <SearchInput
        inputRef={inputRef}
        placeholder="Find in results"
        value="actor"
        onChange={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Clear search' }))

    expect(document.activeElement).toEqual(inputRef.current)
  })

  it('clears on Escape when clearOnEscape is set', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <SearchInput
        clearOnEscape
        placeholder="Filter tables"
        value="actor"
        onChange={onChange}
      />
    )

    await user.type(screen.getByPlaceholderText('Filter tables'), '{Escape}')

    expect(onChange.mock.calls).toEqual([['']])
  })

  it('leaves an empty input alone on Escape', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <SearchInput
        clearOnEscape
        placeholder="Filter tables"
        value=""
        onChange={onChange}
      />
    )

    await user.type(screen.getByPlaceholderText('Filter tables'), '{Escape}')

    expect(onChange).not.toHaveBeenCalled()
  })

  // Find in results closes on Escape and keeps its query for the next time it
  // opens, so clearing there would throw the query away.
  it('keeps the text on Escape without clearOnEscape', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <SearchInput
        placeholder="Find in results"
        value="actor"
        onChange={onChange}
      />
    )

    await user.type(screen.getByPlaceholderText('Find in results'), '{Escape}')

    expect(onChange).not.toHaveBeenCalled()
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
