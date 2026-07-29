import { describe, expect, it } from 'vitest'

import { truncateValue } from './spans'

describe('truncateValue', () => {
  it('returns short values unchanged', () => {
    expect(truncateValue('SELECT 1', 2000)).toEqual('SELECT 1')
  })

  it('returns values at the limit unchanged', () => {
    expect(truncateValue('ab', 2)).toEqual('ab')
  })

  it('truncates long values to the limit with a trailing ellipsis', () => {
    expect(truncateValue('abcdef', 4)).toEqual('abc…')
  })
})
