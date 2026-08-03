import { CircleArrowUpIcon } from 'lucide-react'
import { ReactElement, useState } from 'react'

import { useInstallUpdate } from '../hooks/mutations'
import { useUpdateStatus } from '../hooks/queries'
import { Button } from './ui/button'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

function versionHeading(version: string | null, verb: string): string {
  if (version === null) {
    return `An update is ${verb}`
  }

  return `Squeal ${version} is ${verb}`
}

// Opens in the user's browser rather than a Squeal window: the main process
// denies every child window and hands https URLs to the OS instead.
function ReleaseNotesLink({
  children,
  url
}: {
  children: string
  url: string
}): ReactElement {
  return (
    <a
      className="text-accent hover:underline"
      href={url}
      rel="noreferrer"
      target="_blank"
    >
      {children}
    </a>
  )
}

// Absent from the status bar unless there is something to act on. Squeal has no
// menu bar to hang a "check for updates" item off, so an always-visible icon
// would be an affordance that does nothing for the entire life of the session.
export function UpdateIndicator(): ReactElement | null {
  const [open, setOpen] = useState(false)

  const status = useUpdateStatus()
  const installUpdate = useInstallUpdate()

  if (
    status.data === undefined ||
    (status.data.state !== 'available' && status.data.state !== 'ready')
  ) {
    return null
  }

  const { message, releaseNotesUrl, state, version } = status.data

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
    >
      <PopoverTrigger
        aria-label="Update available"
        className="flex-none text-accent hover:brightness-125"
        title={versionHeading(version, 'available')}
        type="button"
      >
        <CircleArrowUpIcon className="size-[13px]" />
      </PopoverTrigger>

      <PopoverContent className="flex flex-col gap-3 text-[12.5px]">
        <div className="flex flex-col gap-1">
          <p className="font-medium text-text">
            {versionHeading(version, state === 'ready' ? 'ready' : 'available')}
          </p>

          <p className="text-text2">
            {state === 'ready'
              ? 'Squeal will restart to finish installing. This takes a moment.'
              : message}
          </p>
        </div>

        {installUpdate.isError && (
          <p className="text-err">
            The update could not be started. Try again, or download it from the
            release page.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {state === 'ready' ? (
            <Button
              // Stays disabled after success too: the install is already
              // scheduled and the window is about to close, so a second click
              // could only start a second one.
              disabled={installUpdate.isPending || installUpdate.isSuccess}
              size="sm"
              onClick={() => installUpdate.mutate()}
            >
              {installUpdate.isSuccess ? 'Restarting…' : 'Restart to update'}
            </Button>
          ) : (
            releaseNotesUrl !== null && (
              <Button
                asChild
                size="sm"
                variant="outline"
              >
                <a
                  href={releaseNotesUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open release page
                </a>
              </Button>
            )
          )}

          {state === 'ready' && releaseNotesUrl !== null && (
            <ReleaseNotesLink url={releaseNotesUrl}>
              Release notes
            </ReleaseNotesLink>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
