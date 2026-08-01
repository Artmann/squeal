import { useMemo } from 'react'

import { canceledQueryMessage } from '@/glue/queries'
import type { QueryDto } from '@/glue/api/schemas'

import { toQueryErrorParts } from '../components/query-error-parts'
import { useQueriesList } from './queries'

export interface WorksheetMessage {
  id: string
  text: string
  timestamp: number
}

// A long session can run a lot of statements, and the log is derived on every
// render, so it is capped rather than allowed to grow with the session.
export const maxWorksheetMessages = 200

function firstLine(text: string): string {
  const [line] = text.trim().split('\n')

  return line?.trim() ?? ''
}

/**
 * Builds the Messages tab's log from the worksheet's queries. Nothing is
 * stored — every line is derived from a query that already exists, so the log
 * survives a reload for free and cannot drift from the results.
 */
export function buildWorksheetMessages(
  queries: QueryDto[]
): WorksheetMessage[] {
  const messages: WorksheetMessage[] = []

  const ordered = [...queries].sort((a, b) => a.queriedAt - b.queriedAt)

  for (const query of ordered) {
    const statement = firstLine(query.content)

    if (statement !== '') {
      messages.push({
        id: `${query.id}:run`,
        text: statement,
        timestamp: query.queriedAt
      })
    }

    if (query.error !== null) {
      messages.push({
        id: `${query.id}:error`,
        text:
          query.error === canceledQueryMessage
            ? 'Query canceled.'
            : toQueryErrorParts(query.error).title,
        timestamp: query.finishedAt ?? query.queriedAt
      })

      continue
    }

    if (query.result === null) {
      continue
    }

    const duration = (query.finishedAt ?? query.queriedAt) - query.queriedAt
    const rowCount = Intl.NumberFormat().format(query.result.rowCount)
    const suffix = query.result.truncated ? '+' : ''
    const noun = query.result.rowCount === 1 ? 'row' : 'rows'

    messages.push({
      id: `${query.id}:result`,
      text: `${rowCount}${suffix} ${noun} in ${Intl.NumberFormat().format(duration)} ms`,
      timestamp: query.finishedAt ?? query.queriedAt
    })
  }

  // Newest last, so the freshest lines are the ones kept.
  return messages.slice(-maxWorksheetMessages)
}

export function useWorksheetMessages(
  worksheetId: string | undefined
): WorksheetMessage[] {
  const queries = useQueriesList()

  return useMemo(() => {
    if (!worksheetId) {
      return []
    }

    return buildWorksheetMessages(
      queries.data.filter((query) => query.worksheetId === worksheetId)
    )
  }, [queries.data, worksheetId])
}
