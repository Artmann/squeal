import { zodResolver } from '@hookform/resolvers/zod'
import {
  CheckCircle2Icon,
  FolderOpenIcon,
  Loader2Icon,
  LoaderCircleIcon,
  XCircleIcon
} from 'lucide-react'
import { ReactElement, ReactNode, useCallback, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { CreateConnectionTestResponse } from '@/databases'
import {
  ConnectionInfo,
  createDatabaseSchema,
  DatabaseType,
  databaseTypeSchema,
  SslMode
} from '@/databases/schemas'
import { ApiError } from '@/errors'
import { DatabaseDto } from '@/glue/databases'
import { WorksheetDto } from '@/glue/worksheets'
import { apiClient } from '../api-client'
import { useCreateDatabase, useUpdateDatabase } from '../hooks/mutations'
import { Button } from './ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from './ui/form'
import { Input } from './ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from './ui/select'
import { Separator } from './ui/separator'

type FormInput = z.input<typeof createDatabaseSchema>
type FormOutput = z.output<typeof createDatabaseSchema>

export interface DatabaseFormResult {
  database: DatabaseDto
  updatedWorksheet?: WorksheetDto
}

export interface DatabaseFormProps {
  databaseId?: string
  defaultValues?: Partial<FormInput>
  onCancel?: () => void
  onSuccess?: (result: DatabaseFormResult) => void
}

function getDefaultConnectionInfo(
  type: DatabaseType,
  connectionInfo?: Record<string, unknown>
) {
  if (type === 'sqlite') {
    return {
      path: (connectionInfo?.path as string) ?? ''
    }
  }

  return {
    database: (connectionInfo?.database as string) ?? '',
    host: (connectionInfo?.host as string) ?? '',
    password: (connectionInfo?.password as string) ?? '',
    port: connectionInfo?.port as number | undefined,
    sslMode: (connectionInfo?.sslMode as SslMode) ?? undefined,
    sslRootCert: (connectionInfo?.sslRootCert as string) ?? '',
    username: (connectionInfo?.username as string) ?? ''
  }
}

export function DatabaseForm({
  databaseId,
  defaultValues,
  onCancel,
  onSuccess
}: DatabaseFormProps): ReactElement {
  const isEditMode = Boolean(databaseId)
  const defaultType = (defaultValues?.type as DatabaseType) ?? 'postgres'

  const form = useForm<FormInput, unknown, FormOutput>({
    defaultValues: {
      connectionInfo: getDefaultConnectionInfo(
        defaultType,
        defaultValues?.connectionInfo as Record<string, unknown>
      ),
      name: defaultValues?.name ?? '',
      type: defaultType
    },
    resolver: zodResolver(createDatabaseSchema)
  })

  const createDatabase = useCreateDatabase()
  const updateDatabase = useUpdateDatabase()

  const [connectTestResult, setConnectTestResult] = useState<
    CreateConnectionTestResponse | undefined
  >()
  const [isTestingConnection, setIsTestingConnection] = useState(false)

  const isSaving = createDatabase.isPending || updateDatabase.isPending

  const databaseType = form.watch('type')
  const connectionInfo = form.watch('connectionInfo')

  const handleTypeChange = useCallback(
    (newType: string) => {
      const validatedType = databaseTypeSchema.parse(newType)

      form.setValue('type', validatedType)
      form.setValue(
        'connectionInfo',
        getDefaultConnectionInfo(validatedType, undefined)
      )
      setConnectTestResult(undefined)
    },
    [form]
  )

  const handleBrowseFile = useCallback(async () => {
    const filePath = await window.electron.openFileDialog()

    if (filePath) {
      form.setValue('connectionInfo.path', filePath)
    }
  }, [form])

  const handleSubmit = useCallback(
    (values: FormOutput) => {
      form.clearErrors()

      const handleSuccess = (result: DatabaseFormResult) => {
        toast.success(isEditMode ? 'Database updated!' : 'Database saved!', {
          description: isEditMode
            ? `${result.database.name} has been updated.`
            : `${result.database.name} has been added.`
        })

        onSuccess?.(result)
      }

      const handleFailure = (error: unknown) => {
        console.error('Save database error:', error)

        const message =
          error instanceof Error ? error.message : 'Unknown error'

        toast.error('Failed to save database', { description: message })

        form.setError('root', { message })

        if (error instanceof ApiError && error.details) {
          const fieldErrors = errorDetailsToFormFieldErrors(error.details)

          for (const [field, { message: fieldMessage }] of Object.entries(
            fieldErrors
          )) {
            form.setError(field as keyof FormInput, {
              message: fieldMessage,
              type: 'server'
            })
          }
        }
      }

      if (isEditMode && databaseId) {
        updateDatabase.mutate(
          { id: databaseId, request: values },
          {
            onSuccess: handleSuccess,
            onError: handleFailure
          }
        )
      } else {
        createDatabase.mutate(values, {
          onSuccess: handleSuccess,
          onError: handleFailure
        })
      }
    },
    [createDatabase, databaseId, form, isEditMode, onSuccess, updateDatabase]
  )

  const handleTestConnection = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault()

      form.clearErrors()

      setIsTestingConnection(true)
      setConnectTestResult(undefined)

      let normalizedConnectionInfo = connectionInfo

      if (databaseType !== 'sqlite' && 'port' in connectionInfo) {
        normalizedConnectionInfo = {
          ...connectionInfo,
          port:
            typeof connectionInfo.port === 'string'
              ? parseInt(connectionInfo.port, 10) || undefined
              : connectionInfo.port
        }
      }

      const minDelay = new Promise<void>((resolve) => setTimeout(resolve, 100))

      Promise.all([
        apiClient.testConnection(
          normalizedConnectionInfo as ConnectionInfo,
          databaseType
        ),
        minDelay
      ])
        .then(([result]) => {
          if (result.success) {
            toast.success('Connection successful!')
          } else {
            toast.error('Connection failed', { description: result.message })
          }

          setConnectTestResult(result)
        })
        .catch((error) => {
          toast.error('Connection test failed', { description: error.message })

          form.setError('root', { message: error.message })

          if (error instanceof ApiError && error.details) {
            const fieldErrors = errorDetailsToFormFieldErrors(error.details)

            for (const [field, { message }] of Object.entries(fieldErrors)) {
              form.setError(field as keyof FormInput, {
                message,
                type: 'server'
              })
            }
          }
        })
        .finally(() => {
          setIsTestingConnection(false)
        })
    },
    [connectionInfo, databaseType, form]
  )

  const isLoading = isSaving || isTestingConnection

  const connectionTestIcon = useMemo(() => {
    if (isTestingConnection) {
      return <LoaderCircleIcon className="animate-spin" />
    }

    if (connectTestResult?.success === true) {
      return (
        <CheckCircle2Icon
          className="text-green-500"
          data-testid="connection-success-icon"
        />
      )
    }

    if (connectTestResult?.success === false) {
      return (
        <XCircleIcon
          className="text-destructive"
          data-testid="connection-error-icon"
        />
      )
    }

    return null
  }, [isTestingConnection, connectTestResult])

  return (
    <Form {...form}>
      <form
        className="flex flex-col gap-8"
        onSubmit={form.handleSubmit(handleSubmit)}
      >
        <FormSection>
          <FormSectionHeader>
            <FormSectionTitle text="Connection Details" />

            <FormSectionHeaderActions>
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <Select
                      value={field.value}
                      onValueChange={handleTypeChange}
                    >
                      <FormControl>
                        <SelectTrigger className="w-32 h-8 text-xs">
                          <SelectValue placeholder="Database type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="mysql">MySQL</SelectItem>
                        <SelectItem value="postgres">PostgreSQL</SelectItem>
                        <SelectItem value="sqlite">SQLite</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormSectionHeaderActions>
          </FormSectionHeader>

          <Separator />

          <div className="flex items-start gap-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem className="flex-1">
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Analytics Replica"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {databaseType === 'sqlite' ? (
            <FormField
              control={form.control}
              name="connectionInfo.path"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>File Path</FormLabel>
                  <div className="flex gap-2">
                    <FormControl>
                      <Input
                        className="flex-1"
                        placeholder="/path/to/database.sqlite"
                        type="text"
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <Button
                      size="icon"
                      type="button"
                      variant="outline"
                      onClick={handleBrowseFile}
                    >
                      <FolderOpenIcon className="h-4 w-4" />
                    </Button>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : (
            <>
              <div className="flex items-start gap-4">
                <FormField
                  control={form.control}
                  name="connectionInfo.host"
                  render={({ field }) => (
                    <FormItem className="flex-1">
                      <FormLabel>Host</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="us-east-1.db.planetscale.com"
                          {...field}
                          value={field.value ?? ''}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="connectionInfo.port"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Port</FormLabel>
                      <FormControl>
                        <Input
                          className="w-32"
                          placeholder={
                            databaseType === 'mysql' ? '3306' : '5432'
                          }
                          type="number"
                          name={field.name}
                          onBlur={field.onBlur}
                          ref={field.ref}
                          value={field.value == null ? '' : field.value}
                          onChange={(event) => {
                            const value = event.target.value

                            field.onChange(
                              value === '' ? undefined : Number(value)
                            )
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="connectionInfo.database"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Database</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="store"
                        type="text"
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          )}
        </FormSection>

        {databaseType !== 'sqlite' && (
          <FormSection>
            <FormSectionHeader>
              <FormSectionTitle text="Authentication" />
            </FormSectionHeader>

            <Separator />

            <div className="flex items-start gap-4">
              <FormField
                control={form.control}
                name="connectionInfo.username"
                render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormLabel>Username</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="postgres"
                        type="text"
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="connectionInfo.password"
                render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="password"
                        type="password"
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </FormSection>
        )}

        {databaseType !== 'sqlite' && (
          <FormSection>
            <FormSectionHeader>
              <FormSectionTitle text="SSL" />
            </FormSectionHeader>

            <Separator />

            <div className="flex items-start gap-4">
              <FormField
                control={form.control}
                name="connectionInfo.sslMode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>SSL Mode</FormLabel>
                    <Select
                      value={field.value ?? ''}
                      onValueChange={(value) => {
                        field.onChange(value === '' ? undefined : value)
                      }}
                    >
                      <FormControl>
                        <SelectTrigger className="w-40">
                          <SelectValue placeholder="Disabled" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="disable">Disabled</SelectItem>
                        <SelectItem value="require">Require</SelectItem>
                        <SelectItem value="verify-full">Verify Full</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {form.watch('connectionInfo.sslMode') === 'verify-full' && (
              <FormField
                control={form.control}
                name="connectionInfo.sslRootCert"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>SSL Root Certificate</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="system"
                        type="text"
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      Path to a CA certificate file, or <code>system</code> to
                      use the OS trust store.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </FormSection>
        )}

        <div className="flex justify-end gap-3 py-4">
          {onCancel && (
            <Button
              disabled={isLoading}
              size="sm"
              type="button"
              variant="ghost"
              onClick={onCancel}
            >
              Cancel
            </Button>
          )}

          <Button
            disabled={isLoading}
            size="sm"
            type="button"
            variant="outline"
            onClick={handleTestConnection}
          >
            {connectionTestIcon}
            Test Connection
          </Button>

          <Button
            disabled={isLoading}
            size="sm"
            type="submit"
          >
            {isSaving && <Loader2Icon className="size-3 animate-spin" />}
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </form>
    </Form>
  )
}

function FormSection({ children }: { children: ReactNode }): ReactElement {
  return <div className="flex flex-col gap-4">{children}</div>
}

function FormSectionHeader({
  children
}: {
  children: ReactNode
}): ReactElement {
  return <div className="flex items-center justify-between">{children}</div>
}

function FormSectionTitle({ text }: { text: string }): ReactElement {
  return <h2 className="text-sm font-medium">{text}</h2>
}

function FormSectionHeaderActions({
  children
}: {
  children: ReactNode
}): ReactElement {
  return <div className="flex items-center gap-2">{children}</div>
}

type FieldErrors = Record<string, { message: string }>

function errorDetailsToFormFieldErrors(
  details: Record<string, unknown>,
  prefix = ''
): FieldErrors {
  const errors: FieldErrors = {}

  for (const [key, value] of Object.entries(details)) {
    const path = prefix ? `${prefix}.${key}` : key

    if (typeof value === 'string') {
      errors[path] = { message: value }
    } else if (value && typeof value === 'object') {
      Object.assign(
        errors,
        errorDetailsToFormFieldErrors(value as Record<string, unknown>, path)
      )
    }
  }

  return errors
}
