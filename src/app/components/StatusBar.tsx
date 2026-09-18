import { ActivityIcon, SettingsIcon } from 'lucide-react'
import { ReactElement } from 'react'

import { isQueryFinished } from '@/glue/queries'
import type { QueryDto } from '@/glue/api/schemas'
import type { DatabaseDto } from '@/glue/databases'
import { findEnvironment } from '@/glue/environments'

import { useEnvironments, useServerVersion } from '../hooks/queries'
import { cn } from '../lib/utils'
import { useAppDispatch } from '../store'
import { uiActions } from '../store/ui-slice'
import { environmentHueStyle } from './EnvironmentBadge'
import { UpdateIndicator } from './UpdateIndicator'
import type { CursorPosition } from './worksheet-editor-cursor'

type ConnectionHealth = 'failed' | 'succeeded' | 'unknown'

interface StatusBarProps {
  cursorPosition: CursorPosition | undefined
  /** The worksheet's connection, or undefined when it has none this app knows. */
  database: DatabaseDto | undefined
  hasSaveFailed: boolean
  query: QueryDto | undefined
}

const healthColors: Record<ConnectionHealth, string> = {
  failed: 'var(--err)',
  succeeded: 'var(--ok)',
  unknown: 'var(--text3)'
}

// The dot records the last run rather than probing the connection, so the
// tooltip says exactly that — it will not notice a connection that dies while
// the app sits idle.
const healthTitles: Record<ConnectionHealth, string> = {
  failed: 'Last query failed',
  succeeded: 'Last query succeeded',
  unknown: 'No queries run yet'
}

function getConnectionHealth(query: QueryDto | undefined): ConnectionHealth {
  if (!isQueryFinished(query)) {
    return 'unknown'
  }

  return query.error === null ? 'succeeded' : 'failed'
}

function formatRunSummary(query: QueryDto | undefined): string | undefined {
  if (!isQueryFinished(query)) {
    return undefined
  }

  if (query.error !== null) {
    return 'Query failed'
  }

  if (!query.result) {
    return undefined
  }

  const seconds = (query.finishedAt - query.queriedAt) / 1000
  const count = Intl.NumberFormat().format(query.result.rowCount)
  const suffix = query.result.truncated ? '+' : ''
  const noun = query.result.rowCount === 1 ? 'row' : 'rows'

  return `${count}${suffix} ${noun} in ${seconds.toFixed(2)} s`
}

export function StatusBar({
  cursorPosition,
  database,
  hasSaveFailed,
  query
}: StatusBarProps): ReactElement {
  const dispatch = useAppDispatch()
  const serverVersion = useServerVersion(database)
  const environments = useEnvironments()

  const environment = findEnvironment(
    environments,
    database?.environmentId ?? null
  )

  const health = getConnectionHealth(query)
  const runSummary = formatRunSummary(query)

  return (
    // The whole bar takes the environment's colour rather than showing another
    // badge. The point is that it is unmissable without being read: the strip
    // along the bottom of the window going red is what stops a query aimed at
    // production, and a badge among six other status items is not.
    <footer
      className={cn(
        'flex h-[27px] flex-none items-center gap-4 border-t px-[14px] text-[11.5px] text-text2',
        environment === undefined
          ? 'border-border bg-panel2'
          : 'border-env-border bg-env-bg'
      )}
      style={environment && environmentHueStyle(environment)}
    >
      <span
        className="flex items-center gap-2"
        title={healthTitles[health]}
      >
        <span
          aria-hidden="true"
          className="size-[7px] flex-none rounded-full"
          style={{ backgroundColor: healthColors[health] }}
        />

        {database?.name ?? 'No database'}
      </span>

      {environment !== undefined && (
        <span className="text-env">{environment.name}</span>
      )}

      {serverVersion !== undefined && (
        <span className="text-text3">{serverVersion}</span>
      )}

      {runSummary !== undefined && (
        <span className="text-text3">{runSummary}</span>
      )}

      <div className="ml-auto flex items-center gap-4">
        {hasSaveFailed && <span className="text-err">Save failed</span>}

        <span className="text-text3">
          {cursorPosition
            ? `Ln ${cursorPosition.line}, Col ${cursorPosition.column}`
            : 'Ln 1, Col 1'}
        </span>

        <span className="text-text3">UTF-8</span>

        <UpdateIndicator />

        <button
          aria-label="Open settings"
          className="flex-none text-text3 hover:text-text"
          title="Settings"
          type="button"
          onClick={() => dispatch(uiActions.openSettings())}
        >
          <SettingsIcon className="size-[11px]" />
        </button>

        <button
          aria-label="Open traces"
          className="flex-none text-text3 hover:text-text"
          title="Traces ⌘⇧T"
          type="button"
          onClick={() => dispatch(uiActions.toggleTraceDashboard())}
        >
          <ActivityIcon className="size-[11px]" />
        </button>
      </div>
    </footer>
  )
}
