import { QueryErrorResetBoundary } from '@tanstack/react-query'
import { Loader2Icon } from 'lucide-react'
import {
  Component,
  ErrorInfo,
  ReactNode,
  Suspense,
  useCallback,
  useEffect
} from 'react'

import { useCollections } from './collections-context'
import { Button } from './components/ui/button'
import { useQueriesList, useWorksheets } from './hooks/queries'
import { useAppDispatch, useAppSelector } from './store'
import { editorSlice } from './store/editor-slice'
import { pickWorksheetToOpen } from './worksheet-selection'

function FullScreenSpinner(): ReactNode {
  return (
    <div className="w-full h-screen flex items-center justify-center bg-mantle">
      <Loader2Icon className="size-6 animate-spin text-subtext-0" />
    </div>
  )
}

function DataLoadError({ onRetry }: { onRetry: () => void }): ReactNode {
  return (
    <div className="w-full h-screen flex items-center justify-center bg-mantle">
      <div className="w-full max-w-sm flex flex-col gap-4 text-center">
        <h2 className="text-lg font-medium">Could not load your data</h2>

        <p className="text-subtext-0 text-sm">
          The app could not reach the local server. Make sure it is running and
          try again.
        </p>

        <div className="flex justify-center">
          <Button onClick={onRetry}>Try again</Button>
        </div>
      </div>
    </div>
  )
}

interface ErrorBoundaryProps {
  children: ReactNode
  fallback: (reset: () => void) => ReactNode
  onReset?: () => void
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
  }

  render(): ReactNode {
    if (this.state.error) {
      return this.props.fallback(() => {
        this.props.onReset?.()
        this.setState({ error: null })
      })
    }

    return this.props.children
  }
}

function AppDataLoader({ children }: { children: ReactNode }): ReactNode {
  const worksheets = useWorksheets()

  useQueriesList()

  const dispatch = useAppDispatch()
  const openWorksheetId = useAppSelector(
    (state) => state.editor.openWorksheetId
  )

  useEffect(() => {
    const pick = pickWorksheetToOpen(worksheets.data, openWorksheetId)

    if (pick) {
      dispatch(editorSlice.actions.worksheetSelected(pick))
    }
  }, [worksheets.data, openWorksheetId, dispatch])

  return children
}

export function AppShell({ children }: { children: ReactNode }): ReactNode {
  const collections = useCollections()

  // Resetting the query error boundary is not enough to restart a collection
  // whose sync failed, so clear collection errors too.
  const clearCollectionErrors = useCallback(() => {
    const all = [
      collections.databases,
      collections.queries,
      collections.worksheets
    ]

    for (const collection of all) {
      if (collection.utils.isError) {
        void collection.utils.clearError().catch((): void => undefined)
      }
    }
  }, [collections])

  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary
          fallback={(retry) => <DataLoadError onRetry={retry} />}
          onReset={() => {
            reset()
            clearCollectionErrors()
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
