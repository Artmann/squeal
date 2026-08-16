import { describe, expect, it } from 'vitest'

import { normalizeCompletion } from './completion-text'

describe('normalizeCompletion', () => {
  it('returns a plain continuation untouched', () => {
    expect(normalizeCompletion('title, release_year', 'select ')).toEqual(
      'title, release_year'
    )
  })

  it('strips a markdown fence with a language tag', () => {
    const raw = '```sql\nselect * from film\n```'

    expect(normalizeCompletion(raw, '')).toEqual('select * from film')
  })

  it('strips a markdown fence without a language tag', () => {
    expect(normalizeCompletion('```\nfrom film\n```', '')).toEqual('from film')
  })

  it('leaves an unfenced answer containing backticks alone', () => {
    expect(normalizeCompletion('`title`, `length`', 'select ')).toEqual(
      '`title`, `length`'
    )
  })

  it('strips the whole prefix when the model restates it', () => {
    const raw = 'select * from film where'

    expect(normalizeCompletion(raw, 'select * from film')).toEqual(' where')
  })

  it('strips a partial echo of the end of the prefix', () => {
    const raw = 'from film\nwhere rating = 0'
    const prefix = 'select title\nfrom '

    expect(normalizeCompletion(raw, prefix)).toEqual('film\nwhere rating = 0')
  })

  it('keeps a multi-line suggestion and its indentation', () => {
    const raw = '\n\n  title,\n  release_year\nfrom film'

    expect(normalizeCompletion(raw, 'select ')).toEqual(
      '  title,\n  release_year\nfrom film'
    )
  })

  it('drops trailing whitespace', () => {
    expect(normalizeCompletion('from film   \n\n', 'select * ')).toEqual(
      'from film'
    )
  })

  it('returns null for an empty answer', () => {
    expect(normalizeCompletion('', 'select ')).toEqual(null)
  })

  it('returns null for a whitespace-only answer', () => {
    expect(normalizeCompletion('  \n\n  ', 'select ')).toEqual(null)
  })

  it('returns null when the answer is nothing but an echo', () => {
    expect(
      normalizeCompletion('select * from film', 'select * from film')
    ).toEqual(null)
  })

  it('keeps only the fenced block when the model explains itself around it', () => {
    const raw = [
      'It looks like your query is incomplete. Here is one that works:',
      '',
      '```sql',
      'film',
      '```',
      '',
      'Let me know which table you meant!'
    ].join('\n')

    expect(normalizeCompletion(raw, 'select * from ')).toEqual('film')
  })

  it('keeps the first block when a chatty answer offers several', () => {
    const raw = '```sql\nfilm\n```\n\nor:\n\n```sql\nactor\n```'

    expect(normalizeCompletion(raw, 'select * from ')).toEqual('film')
  })

  it('strips an opening fence that was never closed', () => {
    expect(normalizeCompletion('```sql\nfrom film', 'select * ')).toEqual(
      'from film'
    )
  })

  it('returns null for an empty fenced block', () => {
    expect(normalizeCompletion('```sql\n```', 'select ')).toEqual(null)
  })
})
