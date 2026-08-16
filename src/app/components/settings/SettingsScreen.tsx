import { XIcon } from 'lucide-react'
import { ReactElement, ReactNode, useCallback } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

import { useCompletionStatus, useSettings } from '@/app/hooks/queries'
import { useUpdateSettings } from '@/app/hooks/mutations'
import { useTheme } from '@/app/hooks/useTheme'
import { useAppDispatch } from '@/app/store'
import { uiActions } from '@/app/store/ui-slice'
import type { CompletionStatusResponse } from '@/glue/api/schemas'

import { Button } from '../ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../ui/select'
import { Switch } from '../ui/switch'

type ThemeMode = 'dark' | 'light' | 'system'

// Stands in for "no stored preference", which is what lets the server keep
// choosing the best installed model as the user pulls new ones. Ollama names
// every model `name:tag`, so a bare word cannot collide with one.
const automaticModel = 'automatic'

function toThemeMode(value: string): ThemeMode {
  return value === 'dark' || value === 'light' ? value : 'system'
}

function Section({
  children,
  description,
  title
}: {
  children: ReactNode
  description: string
  title: string
}): ReactElement {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold">{title}</h2>

        <p className="text-[12.5px] text-text2">{description}</p>
      </div>

      <div className="flex flex-col gap-4 rounded-md border border-border p-4">
        {children}
      </div>
    </section>
  )
}

function SettingRow({
  children,
  description,
  label
}: {
  children: ReactNode
  description?: string
  label: string
}): ReactElement {
  return (
    <div className="flex items-center gap-6">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13px]">{label}</span>

        {description !== undefined && (
          <span className="text-[12px] text-text3">{description}</span>
        )}
      </div>

      {children}
    </div>
  )
}

// The server already picked the sentence for every Ollama state, so this only
// covers the two states it cannot describe: the check has not answered yet, or
// it never will.
function resolveStatusMessage(
  isError: boolean,
  status: CompletionStatusResponse | undefined
): string {
  if (status) {
    return status.message
  }

  if (isError) {
    return 'Squeal could not check whether Ollama is running. Close and reopen Settings to try again.'
  }

  return 'Checking whether Ollama is running…'
}

function AiSuggestionsSection(): ReactElement {
  const completionStatus = useCompletionStatus()
  const settings = useSettings()
  const updateSettings = useUpdateSettings()

  const { mutate } = updateSettings

  const models = completionStatus.data?.models ?? []

  const handleModelChange = useCallback(
    (value: string) => {
      mutate({
        aiCompletionModel: value === automaticModel ? null : value
      })
    },
    [mutate]
  )

  const handleEnabledChange = useCallback(
    (checked: boolean) => {
      mutate({ aiCompletionsEnabled: checked })
    },
    [mutate]
  )

  return (
    <Section
      description="Squeal asks a local Ollama model to finish the statement you are writing. Nothing leaves your machine."
      title="AI Suggestions"
    >
      <SettingRow
        description="Suggestions appear as grey text after a short pause."
        label="Suggest completions as I type"
      >
        <Switch
          aria-label="Suggest completions as I type"
          checked={settings.data?.aiCompletionsEnabled ?? false}
          disabled={settings.data === undefined}
          onCheckedChange={handleEnabledChange}
        />
      </SettingRow>

      <SettingRow
        description="Automatic picks the best model you have installed."
        label="Model"
      >
        <Select
          disabled={models.length === 0}
          onValueChange={handleModelChange}
          value={settings.data?.aiCompletionModel ?? automaticModel}
        >
          <SelectTrigger
            aria-label="Model"
            className="w-56"
          >
            <SelectValue placeholder="No models installed" />
          </SelectTrigger>

          <SelectContent>
            <SelectItem value={automaticModel}>Automatic</SelectItem>

            {models.map((model) => (
              <SelectItem
                key={model}
                value={model}
              >
                {model}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>

      <p className="text-[12px] text-text2">
        {resolveStatusMessage(completionStatus.isError, completionStatus.data)}
      </p>

      <p className="text-[12px] text-text3">
        Tab to accept · ⌘→ for one word · Esc to dismiss
      </p>
    </Section>
  )
}

function AppearanceSection(): ReactElement {
  const { mode, setMode } = useTheme()

  const handleModeChange = useCallback(
    (value: string) => {
      setMode(toThemeMode(value))
    },
    [setMode]
  )

  return (
    <Section
      description="How Squeal looks on this machine."
      title="Appearance"
    >
      <SettingRow
        description="System follows your operating system."
        label="Theme"
      >
        <Select
          onValueChange={handleModeChange}
          value={mode}
        >
          <SelectTrigger
            aria-label="Theme"
            className="w-56"
          >
            <SelectValue />
          </SelectTrigger>

          <SelectContent>
            <SelectItem value="dark">Dark</SelectItem>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="system">System</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>
    </Section>
  )
}

/**
 * The app's only preferences surface. It overlays a mounted `App`, so unlike
 * `SecretStorageConsentScreen` it does not render its own `TitleBar` — the one
 * behind it is still there, which is why the overlay starts below it.
 */
export function SettingsScreen(): ReactElement {
  const dispatch = useAppDispatch()

  const handleClose = useCallback(() => {
    dispatch(uiActions.closeSettings())
  }, [dispatch])

  useHotkeys('escape', handleClose, { enableOnFormTags: true })

  return (
    <div className="fixed inset-x-0 bottom-0 top-7 z-100 flex flex-col bg-panel">
      <header className="flex items-center gap-3 border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold">Settings</h1>

        <div className="ml-auto">
          <Button
            aria-label="Close settings"
            onClick={handleClose}
            size="icon-sm"
            variant="ghost"
          >
            <XIcon className="size-4" />
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-6 py-8">
          <AiSuggestionsSection />

          <AppearanceSection />
        </div>
      </div>
    </div>
  )
}
