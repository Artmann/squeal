import { QueryErrorResetBoundary } from '@tanstack/react-query'
import { Loader2Icon } from 'lucide-react'
import {
  Component,
  ErrorInfo,
  ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useState
} from 'react'

import type { Collections } from './collections'
import { useCollections } from './collections-context'
import { SecretStorageConsentScreen } from './components/SecretStorageConsentScreen'
import { Button } from './components/ui/button'
import {
  useDatabases,
  useQueriesList,
  useSecretStorage,
  useWorksheets
} from './hooks/queries'
import { useAppDispatch, useAppSelector } from './store'
import { selectActiveWorksheetId, tabsActions } from './store/tabs-slice'
import { captureRendererError } from './tracing/init'
import { pickWorksheetToOpen } from './worksheet-selection'

function FullScreenSpinner(): ReactNode {
  return (
    <div
      aria-label="Loading Squeal"
      className="w-full h-screen flex items-center justify-center bg-panel2"
      role="status"
    >
      <Loader2Icon className="size-6 animate-spin text-text2" />
    </div>
  )
}

function DataLoadError({
  onRetry
}: {
  onRetry: () => Promise<void>
}): ReactNode {
  const [retrying, setRetrying] = useState(false)

  const retry = useCallback(async () => {
    setRetrying(true)

    try {
      await onRetry()
    } finally {
      // A successful retry unmounts this, which makes the update a no-op. A
      // failed one lands back here with the button usable again.
      setRetrying(false)
    }
  }, [onRetry])

  return (
    <div className="w-full h-screen flex items-center justify-center bg-panel2">
      <div className="w-full max-w-sm flex flex-col gap-4 text-center">
        <h2 className="text-lg font-medium">Could not load your data</h2>

        <p className="text-text2 text-sm">
          The app could not reach the local server. Make sure it is running and
          try again.
        </p>

        <div className="flex justify-center">
          <Button
            disabled={retrying}
            onClick={() => void retry()}
          >
            {retrying ? 'Retrying…' : 'Try again'}
          </Button>
        </div>
      </div>
    </div>
  )
}

interface ErrorBoundaryProps {
  children: ReactNode
  fallback: (reset: () => Promise<void>) => ReactNode
  onReset?: () => Promise<void>
}

interface ErrorBoundaryState {
  error: Error | null
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Failed to load application data:', error, info)
    captureRendererError(error, 'error-boundary')
  }

  render(): ReactNode {
    if (this.state.error) {
      return this.props.fallback(async () => {
        // Awaited before clearing the error: the reset remounts the loader,
        // which re-reads the collections' error state, so it has to run after
        // the refetch has settled or it sees the stale failure and lands right
        // back here.
        await this.props.onReset?.()

        this.setState({ error: null })
      })
    }

    return this.props.children
  }
}

function allCollections(collections: Collections) {
  return [collections.databases, collections.queries, collections.worksheets]
}

// Gets every collection loading at once. The reads below suspend one at a time,
// so whichever one came first used to be the only request in flight — the three
// loads ran strictly in sequence, and with retries and backoff that was ~26
// seconds of spinner before a failing backend surfaced anything at all.
//
// Called during render rather than from an effect on purpose: effects do not run
// when a child suspends, which is exactly what happens on the first paint.
// `preload()` caches its own promise, so calling it on every render is free.
function startLoading(collections: Collections): void {
  for (const collection of allCollections(collections)) {
    void collection.preload().catch((): void => undefined)
  }
}

// A collection whose sync failed still reports itself ready — the query
// collection marks ready on its error path — so nothing suspends and the app
// renders an empty shell as if the user simply had no worksheets. That is how a
// broken backend looked like a merely slow one. Throwing here puts it on the
// error screen instead.
function failIfLoadFailed(collections: Collections): void {
  for (const collection of allCollections(collections)) {
    if (collection.utils.isError) {
      throw (
        collection.utils.lastError ??
        new Error('Could not load your data from the local server.')
      )
    }
  }
}

function AppDataLoader({ children }: { children: ReactNode }): ReactNode {
  const collections = useCollections()

  startLoading(collections)

  // Read before the collections so the request goes out on the first render,
  // alongside the three preloads above rather than as a fourth round trip after
  // them.
  const secretStorage = useSecretStorage()

  const worksheets = useWorksheets()

  useQueriesList()
  useDatabases()

  failIfLoadFailed(collections)

  const dispatch = useAppDispatch()
  const activeWorksheetId = useAppSelector(selectActiveWorksheetId)

  useEffect(() => {
    // Tabs are restored from localStorage before the worksheets have loaded, so
    // they can name worksheets deleted in another session. Reconciling here
    // drops those and falls back to the usual pick when nothing survives.
    const availableIds = worksheets.data.map((worksheet) => worksheet.id)

    dispatch(
      tabsActions.tabsReconciled({
        availableIds,
        fallbackId: pickWorksheetToOpen(worksheets.data, activeWorksheetId)
      })
    )
  }, [worksheets.data, activeWorksheetId, dispatch])

  // Below failIfLoadFailed on purpose, and that order is the guarantee: a broken
  // backend has already thrown onto the error screen by now, so the welcome
  // screen can never stand in for one. Returning the screen instead of children
  // also means App never mounts, so the getting-started screen cannot stack with
  // it and none of the pollers start behind it.
  if (secretStorage.mode === 'undecided') {
    return (
      <SecretStorageConsentScreen storageName={secretStorage.storageName} />
    )
  }

  return children
}

export function AppShell({ children }: { children: ReactNode }): ReactNode {
  const collections = useCollections()

  // Resetting the query error boundary is not enough to restart a collection
  // whose sync failed, so clear collection errors too. Awaited, and failures
  // swallowed: a retry that fails again leaves the collection in its error
  // state, which puts the user back on the error screen rather than an empty
  // app.
  const clearCollectionErrors = useCallback(async () => {
    await Promise.all(
      allCollections(collections)
        .filter((collection) => collection.utils.isError)
        .map((collection) =>
          collection.utils.clearError().catch((): void => undefined)
        )
    )
  }, [collections])

  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary
          fallback={(retry) => <DataLoadError onRetry={retry} />}
          onReset={async () => {
            reset()

            await clearCollectionErrors()
          }}
        >
          <Suspense fallback={<FullScreenSpinner />}>
            <AppDataLoader>{children}</AppDataLoader>
          </Suspense>
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  )
}
