import { Loader2Icon, LockIcon, TriangleAlertIcon } from 'lucide-react'
import { ReactElement, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import type { SecretStorageResponse } from '@/glue/api/schemas'

import { useGrantSecretStorage, useSkipSecretStorage } from '../hooks/mutations'
import { TitleBar } from './TitleBar'
import { Button } from './ui/button'

type ConsentStep = 'ask' | 'confirmSkip'

// Recording the granted mode is what unmounts this screen, so a partial success
// has nowhere to be rendered here — it goes to a toast, which outlives the
// unmount and lands over the app the user is about to see.
function reportGrant(response: SecretStorageResponse): void {
  if (response.mode !== 'keychain' || response.message === null) {
    return
  }

  toast.warning('Encryption is on, but some passwords are not', {
    description: response.message
  })
}

// Shown before anything else when no decision has been made about the OS
// keychain, because until then Squeal has nowhere safe to put a connection
// password.
//
// A view rather than a `fixed inset-0` overlay: the window is frameless, so
// covering TitleBar would leave Windows and Linux users with no drag region and
// no close button while the app is deliberately unusable. `text-sm` is set here
// because this replaces App, which is where the rest of the UI inherits it.
export function SecretStorageConsentScreen({
  storageName
}: {
  storageName: string
}): ReactElement {
  const [step, setStep] = useState<ConsentStep>('ask')

  const grant = useGrantSecretStorage()
  const skip = useSkipSecretStorage()
  const grantButton = useRef<HTMLButtonElement>(null)

  // A refused prompt comes back as a successful response carrying a message, not
  // as a rejection — the request itself worked. A message alongside `keychain`
  // is the other thing entirely: permission was granted and some passwords
  // could not be encrypted, which is not something to offer "Try again" for.
  const grantMessage =
    grant.data !== undefined && grant.data.mode !== 'keychain'
      ? grant.data.message
      : null
  const isBusy = grant.isPending || skip.isPending

  // Disabling a focused button drops focus to the body, so hand it back when the
  // refusal turns the button into "Try again".
  useEffect(() => {
    if (grantMessage) {
      grantButton.current?.focus()
    }
  }, [grantMessage])

  return (
    <main className="w-full h-screen flex flex-col bg-panel2 overflow-hidden text-sm">
      <TitleBar />

      <div className="flex-1 min-h-0 flex justify-center items-center overflow-y-auto px-6 py-10">
        <div className="w-full max-w-md flex flex-col gap-6 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-3 motion-safe:duration-500">
          <div>
            <div className="text-lg font-bold tracking-tight text-accent mb-3">
              Squeal
            </div>

            <h1 className="text-3xl font-semibold mb-2">Welcome to Squeal</h1>

            <p className="text-text2">
              Squeal saves the password for every database connection on this
              computer. To keep those passwords encrypted, it needs your
              permission to use {storageName}.
            </p>
          </div>

          {grantMessage && (
            <p
              className="flex items-start gap-2 rounded-md border border-err-border bg-err-bg px-3 py-2 text-xs text-err motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
              role="alert"
            >
              <TriangleAlertIcon className="size-3 shrink-0 mt-[3px]" />
              {grantMessage}
            </p>
          )}

          <div className="flex flex-col gap-3 items-start">
            <Button
              autoFocus
              disabled={isBusy}
              onClick={() =>
                grant.mutate(undefined, { onSuccess: reportGrant })
              }
              ref={grantButton}
              size="lg"
            >
              {grant.isPending && <Loader2Icon className="animate-spin" />}
              {grant.isPending
                ? 'Waiting for permission…'
                : grantMessage
                  ? 'Try again'
                  : 'Turn on encryption'}
            </Button>

            {grant.isPending && (
              <p
                className="text-xs text-text2"
                role="status"
              >
                Your system is asking whether Squeal may use {storageName}.
                Choose Allow to continue — the prompt can open behind this
                window.
              </p>
            )}

            {step === 'ask' && (
              <Button
                className="px-0"
                disabled={isBusy}
                onClick={() => setStep('confirmSkip')}
                size="sm"
                variant="link"
              >
                Skip and save passwords unencrypted
              </Button>
            )}
          </div>

          {step === 'confirmSkip' && (
            <SkipConfirmation
              isBusy={isBusy}
              isPending={skip.isPending}
              onCancel={() => setStep('ask')}
              onConfirm={() => skip.mutate()}
              showError={skip.isError}
            />
          )}

          <p className="flex items-start gap-2 text-xs text-text2">
            <LockIcon className="size-3 shrink-0 mt-[3px]" />
            Squeal only uses {storageName} for connection passwords. Everything
            stays on this machine — nothing is sent anywhere else.
          </p>
        </div>
      </div>
    </main>
  )
}

// A second step rather than one click: the choice is a security downgrade, and
// there is no settings screen to reverse it from — only the notice on a
// connection's password field. An inline panel rather than a modal, because
// there is no dialog primitive here and one screen does not justify a focus
// trap.
function SkipConfirmation({
  isBusy,
  isPending,
  onCancel,
  onConfirm,
  showError
}: {
  isBusy: boolean
  isPending: boolean
  onCancel: () => void
  onConfirm: () => void
  showError: boolean
}): ReactElement {
  const panel = useRef<HTMLDivElement>(null)

  // Focus lands on the panel, not the confirm button: a stray second Enter would
  // otherwise blow straight through the confirmation this panel exists to add.
  useEffect(() => {
    panel.current?.focus()
  }, [])

  return (
    <div
      aria-labelledby="skip-encryption-title"
      className="flex flex-col gap-3 rounded-md border border-border bg-panel p-4 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-200"
      onKeyDown={(event) => {
        // Cancels the confirmation only. Escape never dismisses the screen
        // itself, because there is no state behind it to return to.
        if (event.key === 'Escape') {
          onCancel()
        }
      }}
      ref={panel}
      role="group"
      tabIndex={-1}
    >
      <p
        className="font-medium"
        id="skip-encryption-title"
      >
        Save passwords unencrypted?
      </p>

      <p className="text-xs text-text2">
        Connection passwords will be written to Squeal&apos;s database file on
        this computer as plain text. Anyone who can read your files — or a
        backup of them — can read those passwords. You can turn encryption on
        later from any connection&apos;s Authentication section.
      </p>

      {showError && (
        <p
          className="rounded-md border border-err-border bg-err-bg px-3 py-2 text-xs text-err"
          role="alert"
        >
          Squeal could not save your choice. Try again — if it keeps failing,
          restart Squeal.
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button
          disabled={isBusy}
          onClick={onConfirm}
          size="sm"
          variant="outline"
        >
          {isPending && <Loader2Icon className="size-3 animate-spin" />}
          {isPending ? 'Saving your choice…' : 'Save unencrypted'}
        </Button>

        <Button
          disabled={isBusy}
          onClick={onCancel}
          size="sm"
          variant="ghost"
        >
          Go back
        </Button>
      </div>
    </div>
  )
}
