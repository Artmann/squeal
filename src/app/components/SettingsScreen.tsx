import { PlusIcon, Trash2, XIcon } from 'lucide-react'
import { CSSProperties, ReactElement, useCallback, useState } from 'react'
import { toast } from 'sonner'

import { environmentHues, type EnvironmentDto } from '@/glue/environments'

import { useEnvironments } from '../hooks/queries'
import {
  useCreateEnvironment,
  useDeleteEnvironment,
  useUpdateEnvironment
} from '../hooks/mutations'
import { cn } from '../lib/utils'
import { useAppDispatch } from '../store'
import { uiActions } from '../store/ui-slice'
import { useConfirm } from './ConfirmDialogProvider'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Separator } from './ui/separator'

const environmentNameLimit = 32

function hueStyle(hue: number): CSSProperties {
  return { '--env-hue': String(hue) } as CSSProperties
}

interface HuePickerProps {
  selectedHue: number
  onSelect: (hue: number) => void
}

function HuePicker({ selectedHue, onSelect }: HuePickerProps): ReactElement {
  return (
    <div className="flex flex-none items-center gap-[5px]">
      {environmentHues.map((hue) => (
        <button
          key={hue}
          aria-label={`Colour ${hue}`}
          aria-pressed={hue === selectedHue}
          className={cn(
            'size-[18px] flex-none rounded-full border bg-env-bg',
            hue === selectedHue
              ? 'border-env ring-1 ring-env'
              : 'border-env-border'
          )}
          style={hueStyle(hue)}
          type="button"
          onClick={() => onSelect(hue)}
        />
      ))}
    </div>
  )
}

interface EnvironmentRowProps {
  environment: EnvironmentDto
}

function EnvironmentRow({ environment }: EnvironmentRowProps): ReactElement {
  const confirm = useConfirm()
  const updateEnvironment = useUpdateEnvironment()
  const deleteEnvironment = useDeleteEnvironment()

  // The input is uncontrolled between edits: the committed name lives in the
  // query cache, and typing into a field that re-renders from a mutation
  // response fights the cursor.
  const [name, setName] = useState(environment.name)

  const commitName = useCallback(() => {
    const trimmed = name.trim()

    // An empty name is a slip rather than a request — put back what was there
    // instead of telling the user off for it.
    if (trimmed === '' || trimmed === environment.name) {
      setName(environment.name)

      return
    }

    updateEnvironment.mutate(
      { id: environment.id, request: { name: trimmed } },
      {
        onError: (error) => {
          setName(environment.name)

          toast.error('Failed to rename environment', {
            description:
              error instanceof Error ? error.message : 'Unknown error'
          })
        }
      }
    )
  }, [environment.id, environment.name, name, updateEnvironment])

  const handleSelectHue = useCallback(
    (hue: number) => {
      if (hue === environment.hue) {
        return
      }

      updateEnvironment.mutate(
        { id: environment.id, request: { hue } },
        {
          onError: (error) => {
            toast.error('Failed to change the colour', {
              description:
                error instanceof Error ? error.message : 'Unknown error'
            })
          }
        }
      )
    },
    [environment.hue, environment.id, updateEnvironment]
  )

  const handleDelete = useCallback(() => {
    confirm({
      confirmLabel: 'Delete',
      description:
        'Connections using this environment will keep working; they just lose the label.',
      onConfirm: () => {
        deleteEnvironment.mutate(environment.id, {
          onError: (error) => {
            toast.error('Failed to delete environment', {
              description:
                error instanceof Error ? error.message : 'Unknown error'
            })
          },
          onSuccess: () => {
            toast.success(`Deleted "${environment.name}"`)
          }
        })
      },
      title: `Delete "${environment.name}"?`
    })
  }, [confirm, deleteEnvironment, environment.id, environment.name])

  return (
    <div className="flex items-center gap-3">
      <Input
        aria-label="Environment name"
        className="h-8 min-w-0 flex-1 text-xs"
        maxLength={environmentNameLimit}
        value={name}
        onBlur={commitName}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur()
          }
        }}
      />

      <HuePicker
        selectedHue={environment.hue}
        onSelect={handleSelectHue}
      />

      <Button
        aria-label={`Delete ${environment.name}`}
        size="icon-sm"
        variant="ghost"
        onClick={handleDelete}
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  )
}

function AddEnvironment(): ReactElement {
  const createEnvironment = useCreateEnvironment()

  const handleAdd = useCallback(() => {
    // Created with a placeholder name rather than behind a second form: the
    // row that appears is already editable, and naming it there is the same
    // two fields with one screen less.
    createEnvironment.mutate(
      { hue: environmentHues[0] ?? 25, name: 'New environment' },
      {
        onError: (error) => {
          toast.error('Failed to add environment', {
            description:
              error instanceof Error ? error.message : 'Unknown error'
          })
        }
      }
    )
  }, [createEnvironment])

  return (
    <Button
      className="self-start"
      disabled={createEnvironment.isPending}
      size="sm"
      variant="outline"
      onClick={handleAdd}
    >
      <PlusIcon className="size-3.5" />
      Add environment
    </Button>
  )
}

export function SettingsScreen(): ReactElement {
  const dispatch = useAppDispatch()
  const environments = useEnvironments()

  const handleClose = useCallback(() => {
    dispatch(uiActions.closeSettings())
  }, [dispatch])

  return (
    <div className="absolute inset-0 z-(--z-overlay) bg-bg/70 flex justify-center items-start overflow-y-auto py-6">
      <div className="w-full max-w-lg max-h-full my-auto flex flex-col gap-6 overflow-hidden rounded-md border border-border bg-panel p-6 shadow-[0_8px_24px_rgba(0,0,0,0.14)]">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Settings</h1>

          <Button
            aria-label="Close"
            size="icon-sm"
            variant="ghost"
            onClick={handleClose}
          >
            <XIcon className="size-4" />
          </Button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-medium">Environments</h2>

            <p className="text-xs text-text2">
              Label a connection with the environment it points at. The label
              shows beside the connection and colours the status bar.
            </p>
          </div>

          <Separator />

          <div className="flex flex-col gap-3">
            {environments.map((environment) => (
              <EnvironmentRow
                key={environment.id}
                environment={environment}
              />
            ))}
          </div>

          {environments.length === 0 && (
            <p className="text-xs text-text3">
              No environments. Add one to start labelling connections.
            </p>
          )}

          <AddEnvironment />
        </div>
      </div>
    </div>
  )
}
