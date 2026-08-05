import { LockIcon, XIcon } from 'lucide-react'
import { ReactElement } from 'react'

import { useAppDispatch } from '../store'
import { uiActions } from '../store/ui-slice'
import { DatabaseForm } from './DatabaseForm'
import { Button } from './ui/button'

export function GettingStartedScreen(): ReactElement {
  const dispatch = useAppDispatch()

  const dismiss = () => {
    dispatch(uiActions.dismissGettingStarted())
  }

  return (
    <div className="fixed inset-0 z-100 bg-panel2 flex justify-center items-center overflow-y-auto py-10">
      {/* Both ways out of a screen that is otherwise a dead end until a
          connection is saved: the X for someone who just wants to look around,
          and the link below the form for anyone reading top to bottom. */}
      <Button
        aria-label="Close"
        className="absolute right-4 top-4 text-text2"
        onClick={dismiss}
        size="icon"
        variant="ghost"
      >
        <XIcon className="size-4" />
      </Button>

      <div className="w-full max-w-md flex flex-col gap-6 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-500">
        <div>
          <div className="text-lg font-bold tracking-tight text-accent mb-3">
            Squeal
          </div>

          <h1 className="text-3xl font-semibold mb-2">Connect a database</h1>

          <p className="text-text2">
            Squeal is a SQL client built for humans — write queries, explore
            your schema, and read results without the ceremony. Point it at a
            database to begin.
          </p>
        </div>

        <DatabaseForm />

        <div className="flex flex-col gap-3">
          <Button
            className="self-start px-0"
            onClick={dismiss}
            size="sm"
            variant="link"
          >
            Skip for now
          </Button>

          <p className="flex items-center gap-2 text-xs text-text2">
            <LockIcon className="size-3 shrink-0" />
            Connection details are saved locally on this machine — nothing is
            sent anywhere else.
          </p>
        </div>
      </div>
    </div>
  )
}
