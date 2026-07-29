import { describe, expect, it } from 'vitest'

import { formatDuration } from './format-duration'

describe('formatDuration', () => {
  it('formats sub-millisecond durations with a decimal', () => {
    expect(formatDuration(0.42)).toEqual('0.4ms')
  })

  it('formats milliseconds as whole numbers', () => {
    expect(formatDuration(125.4)).toEqual('125ms')
  })

  it('formats seconds with two decimals', () => {
    expect(formatDuration(2350)).toEqual('2.35s')
  })
})
