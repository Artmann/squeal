import {
  ChevronDownIcon,
  ChevronUpIcon,
  ListFilterIcon,
  XIcon
} from 'lucide-react'
import { KeyboardEvent, ReactElement } from 'react'

import { maxResultRows } from '@/databases/adapter'

import type { ResultsFind } from '../hooks/use-results-find'
import { cn } from '../lib/utils'
import { SearchInput } from './SearchInput'

const iconButtonClassName =
  'flex size-[22px] flex-none items-center justify-center rounded-[5px] text-text2 hover:bg-hover disabled:pointer-events-none disabled:opacity-40'

function formatRowCap(): string {
  return Intl.NumberFormat().format(maxResultRows)
}

/**
 * What the counter says, or `null` when there is nothing worth saying.
 *
 * The truncated wording is the most important text in this feature: a result
 * cut off at the row cap that reports a bare "No matches" answers a question
 * nobody asked, and someone looking for their own id would read it as "this row
 * does not exist".
 */
function formatFindStatus(find: ResultsFind): string | null {
  if (find.rowCount === 0) {
    return 'No rows to search'
  }

  if (find.query.trim() === '') {
    return null
  }

  if (find.matchCount === 0) {
    return find.truncated
      ? `No matches in the first ${formatRowCap()} rows`
      : 'No matches'
  }

  const counted = `${Intl.NumberFormat().format(find.activeOrdinal)} of ${Intl.NumberFormat().format(find.matchCount)}`

  return find.truncated ? `${counted} · first ${formatRowCap()} rows` : counted
}

export function ResultsFindBar({ find }: { find: ResultsFind }): ReactElement {
  const status = formatFindStatus(find)
  const hasMatches = find.matchCount > 0

  // Escape is handled on the bar rather than on the input, so it still closes
  // after a click has moved focus to one of the buttons. A global hotkey would
  // be the wrong tool: it would fire alongside the rename input's own Escape,
  // which cancels without stopping propagation.
  const handleBarKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape') {
      return
    }

    event.preventDefault()
    find.close()
  }

  // Enter stays on the input. On a focused button it would land on top of the
  // button's own activation, so prev-then-Enter would step twice.
  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter') {
      return
    }

    event.preventDefault()

    if (event.shiftKey) {
      find.previous()

      return
    }

    find.next()
  }

  return (
    <div
      className="flex flex-none items-center gap-[2px]"
      onKeyDown={handleBarKeyDown}
    >
      <div className="w-[180px] lg:w-[220px]">
        <SearchInput
          inputRef={find.inputRef}
          placeholder="Find in results"
          value={find.query}
          onChange={find.setQuery}
          onKeyDown={handleInputKeyDown}
        />
      </div>

      {status !== null && (
        <span
          aria-live="polite"
          className="px-[6px] font-mono text-[11.5px] whitespace-nowrap text-text3"
          role="status"
          title={
            find.truncated
              ? `Only the first ${formatRowCap()} rows were returned, so this searches part of the table. Add a WHERE clause to search the rest.`
              : undefined
          }
        >
          {status}
        </span>
      )}

      <button
        aria-label="Previous match"
        className={iconButtonClassName}
        disabled={!hasMatches}
        title="Previous match (⇧↵)"
        type="button"
        onClick={find.previous}
      >
        <ChevronUpIcon className="size-3" />
      </button>

      <button
        aria-label="Next match"
        className={iconButtonClassName}
        disabled={!hasMatches}
        title="Next match (↵)"
        type="button"
        onClick={find.next}
      >
        <ChevronDownIcon className="size-3" />
      </button>

      <button
        aria-label="Hide non-matching rows"
        aria-pressed={find.isFiltering}
        className={cn(
          iconButtonClassName,
          find.isFiltering && 'bg-[var(--sel)] text-text'
        )}
        title="Hide non-matching rows"
        type="button"
        onClick={find.toggleFiltering}
      >
        <ListFilterIcon className="size-3" />
      </button>

      <button
        aria-label="Close find"
        className={iconButtonClassName}
        title="Close find (Esc)"
        type="button"
        onClick={find.close}
      >
        <XIcon className="size-3" />
      </button>
    </div>
  )
}
