import { LockIcon } from 'lucide-react'
import { ReactElement } from 'react'

import { DatabaseForm } from './DatabaseForm'

export function GettingStartedScreen(): ReactElement {
  return (
    <div className="fixed inset-0 z-100 bg-panel2 flex justify-center items-center overflow-y-auto py-10">
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

        <p className="flex items-center gap-2 text-xs text-text2">
          <LockIcon className="size-3 shrink-0" />
          Connection details are saved locally on this machine — nothing is sent
          anywhere else.
        </p>
      </div>
    </div>
  )
}
