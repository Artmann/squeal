import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TimeAgo } from './TimeAgo'

describe('TimeAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-15T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows "a few seconds ago" for timestamps less than a minute ago', () => {
    const timestamp = Date.now() - 30 * 1000
    render(<TimeAgo timestamp={timestamp} />)
    expect(screen.getByText('a few seconds ago')).toBeInTheDocument()
  })

  it('shows "a minute ago" for timestamps about a minute ago', () => {
    const timestamp = Date.now() - 60 * 1000
    render(<TimeAgo timestamp={timestamp} />)
    expect(screen.getByText('a minute ago')).toBeInTheDocument()
  })

  it('shows "5 minutes ago" for timestamps 5 minutes ago', () => {
    const timestamp = Date.now() - 5 * 60 * 1000
    render(<TimeAgo timestamp={timestamp} />)
    expect(screen.getByText('5 minutes ago')).toBeInTheDocument()
  })

  it('shows "an hour ago" for timestamps about an hour ago', () => {
    const timestamp = Date.now() - 60 * 60 * 1000
    render(<TimeAgo timestamp={timestamp} />)
    expect(screen.getByText('an hour ago')).toBeInTheDocument()
  })

  it('shows "3 hours ago" for timestamps 3 hours ago', () => {
    const timestamp = Date.now() - 3 * 60 * 60 * 1000
    render(<TimeAgo timestamp={timestamp} />)
    expect(screen.getByText('3 hours ago')).toBeInTheDocument()
  })

  it('shows "a day ago" for timestamps about a day ago', () => {
    const timestamp = Date.now() - 24 * 60 * 60 * 1000
    render(<TimeAgo timestamp={timestamp} />)
    expect(screen.getByText('a day ago')).toBeInTheDocument()
  })

  it('shows "3 days ago" for timestamps 3 days ago', () => {
    const timestamp = Date.now() - 3 * 24 * 60 * 60 * 1000
    render(<TimeAgo timestamp={timestamp} />)
    expect(screen.getByText('3 days ago')).toBeInTheDocument()
  })
})
