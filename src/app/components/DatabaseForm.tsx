import { zodResolver } from '@hookform/resolvers/zod'
import {
  CheckCircle2Icon,
  ChevronRightIcon,
  FolderOpenIcon,
  Loader2Icon,
  XCircleIcon
} from 'lucide-react'
import { ReactElement, ReactNode, useCallback, useMemo, useState } from 'react'
import { useForm, type Resolver, type UseFormReturn } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import type {
  ConnectionTestResponse,
  CreateDatabaseRequest,
  DatabaseType,
  SslMode,
  UpdateDatabaseConnection,
  UpdateDatabaseRequest
} from '@/glue/api/schemas'
// The form is validated client-side with zod through react-hook-form's
// resolver; the API contract itself is Effect Schema.
import {
  createDatabaseSchema,
  databaseTypeSchema,
  updateDatabaseSchema
} from '@/databases/schemas'
import { ApiError } from '@/errors'
import { DatabaseDto } from '@/glue/databases'
import { WorksheetDto } from '@/glue/worksheets'
import { apiClient } from '../api-client'
import { useCreateDatabase, useUpdateDatabase } from '../hooks/mutations'
import { useEncryptionAvailable } from '../hooks/queries'
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

// The form is typed off the update schema (optional password); create mode
// swaps in the create resolver so the password is still required there.
type FormInput = z.input<typeof updateDatabaseSchema>
type FormOutput = z.output<typeof updateDatabaseSchema>

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

function stringOrEmpty(value: unknown): string {
  return (value as string) ?? ''
}

function getDefaultConnectionInfo(
  type: DatabaseType,
  connectionInfo?: Record<string, unknown>
) {
  const info = connectionInfo ?? {}

  if (type === 'sqlite') {
    return {
      path: stringOrEmpty(info.path)
    }
  }

  return {
    database: stringOrEmpty(info.database),
    host: stringOrEmpty(info.host),
    password: stringOrEmpty(info.password),
    port: info.port as number | undefined,
    sslMode: (info.sslMode as SslMode) ?? undefined,
    sslRootCert: stringOrEmpty(info.sslRootCert),
    username: stringOrEmpty(info.username)
  }
}

// The row exists but its stored secret could not be decrypted — most often
// because the OS keychain was reset. Saving the form re-encrypts and repairs it,
// so say that rather than silently showing blank fields.
function UnreadableConnectionNotice({
  defaultValues,
  isEditMode
}: {
  defaultValues: DatabaseFormProps['defaultValues']
  isEditMode: boolean
}): ReactElement | null {
  const unreadable =
    isEditMode &&
    defaultValues !== undefined &&
    defaultValues.connectionInfo === undefined

  if (!unreadable) {
    return null
  }

  return (
    <p className="rounded-md border border-err-border bg-err-bg px-3 py-2 text-xs text-err">
      Squeal could not read this connection&apos;s stored details. Enter them
      again and save to repair it.
    </p>
  )
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
    resolver: zodResolver(
      isEditMode ? updateDatabaseSchema : createDatabaseSchema
    ) as Resolver<FormInput, unknown, FormOutput>
  })

  const databaseType = form.watch('type')
  const connectionInfo = form.watch('connectionInfo')

  const {
    connectionTestIcon,
    handleTestConnection,
    isTestingConnection,
    resetConnectionTest
  } = useConnectionTest({ connectionInfo, databaseId, databaseType, form })

  const { handleSubmit, isSaving } = useSaveDatabase({
    databaseId,
    form,
    isEditMode,
    onSuccess
  })

  const [showAdvanced, setShowAdvanced] = useState(() =>
    Boolean(
      (defaultValues?.connectionInfo as { sslMode?: string } | undefined)
        ?.sslMode
    )
  )

  const handleTypeChange = useCallback(
    (newType: string) => {
      const validatedType = databaseTypeSchema.parse(newType)

      form.setValue('type', validatedType)
      form.setValue(
        'connectionInfo',
        getDefaultConnectionInfo(validatedType, undefined)
      )
      resetConnectionTest()
    },
    [form, resetConnectionTest]
  )

  const handleBrowseFile = useCallback(async () => {
    const filePath = await window.electron.openFileDialog()

    if (filePath) {
      form.setValue('connectionInfo.path', filePath)
    }
  }, [form])

  const isLoading = isSaving || isTestingConnection

  return (
    <Form {...form}>
      <form
        className="flex flex-col gap-8"
        onSubmit={form.handleSubmit(handleSubmit)}
      >
        <UnreadableConnectionNotice
          defaultValues={defaultValues}
          isEditMode={isEditMode}
        />

        {databaseType !== 'sqlite' && (
          <ConnectionStringSection
            form={form}
            onSslModeApplied={() => setShowAdvanced(true)}
          />
        )}

        <ConnectionDetailsSection
          databaseType={databaseType}
          form={form}
          onBrowseFile={handleBrowseFile}
          onTypeChange={handleTypeChange}
        />

        {databaseType !== 'sqlite' && (
          <AuthenticationSection
            form={form}
            isEditMode={isEditMode}
          />
        )}

        {databaseType !== 'sqlite' &&
          (showAdvanced ? (
            <SslSection form={form} />
          ) : (
            <button
              className="flex items-center gap-1 self-start text-xs text-text2 hover:text-text"
              type="button"
              onClick={() => setShowAdvanced(true)}
            >
              <ChevronRightIcon className="size-3" />
              Advanced (SSL)
            </button>
          ))}

        <DatabaseFormActions
          connectionTestIcon={connectionTestIcon}
          isLoading={isLoading}
          isSaving={isSaving}
          onCancel={onCancel}
          onTestConnection={handleTestConnection}
        />
      </form>
    </Form>
  )
}

type DatabaseFormApi = UseFormReturn<FormInput, unknown, FormOutput>

interface UseSaveDatabaseOptions {
  databaseId?: string
  form: DatabaseFormApi
  isEditMode: boolean
  onSuccess?: (result: DatabaseFormResult) => void
}

function useSaveDatabase({
  databaseId,
  form,
  isEditMode,
  onSuccess
}: UseSaveDatabaseOptions) {
  const createDatabase = useCreateDatabase()
  const updateDatabase = useUpdateDatabase()

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

        const message = error instanceof Error ? error.message : 'Unknown error'

        toast.error('Failed to save database', { description: message })

        form.setError('root', { message })
        applyServerFieldErrors(form, error)
      }

      if (isEditMode && databaseId) {
        updateDatabase.mutate(
          // The resolver validated connectionInfo, which zod's transform
          // output types as optional.
          { id: databaseId, request: values as UpdateDatabaseRequest },
          {
            onSuccess: handleSuccess,
            onError: handleFailure
          }
        )
      } else {
        // The create resolver validated the password, so the cast is safe.
        createDatabase.mutate(values as CreateDatabaseRequest, {
          onSuccess: handleSuccess,
          onError: handleFailure
        })
      }
    },
    [createDatabase, databaseId, form, isEditMode, onSuccess, updateDatabase]
  )

  return {
    handleSubmit,
    isSaving: createDatabase.isPending || updateDatabase.isPending
  }
}

interface UseConnectionTestOptions {
  connectionInfo: FormInput['connectionInfo']
  databaseId?: string
  databaseType: DatabaseType
  form: DatabaseFormApi
}

function useConnectionTest({
  connectionInfo,
  databaseId,
  databaseType,
  form
}: UseConnectionTestOptions) {
  const [connectTestResult, setConnectTestResult] = useState<
    ConnectionTestResponse | undefined
  >()
  const [isTestingConnection, setIsTestingConnection] = useState(false)

  const resetConnectionTest = useCallback(() => {
    setConnectTestResult(undefined)
  }, [])

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

      // The type and its info travel as one value to the API, which validates
      // the pair. Narrowed here for the same reason the submit path does it:
      // zod types the transformed connectionInfo as optional.
      const connection = {
        connectionInfo: normalizedConnectionInfo,
        type: databaseType
      } as UpdateDatabaseConnection

      Promise.all([apiClient.testConnection(connection, databaseId), minDelay])
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
          applyServerFieldErrors(form, error)
        })
        .finally(() => {
          setIsTestingConnection(false)
        })
    },
    [connectionInfo, databaseId, databaseType, form]
  )

  const connectionTestIcon = useMemo(() => {
    if (isTestingConnection) {
      return <Loader2Icon className="animate-spin" />
    }

    if (connectTestResult?.success === true) {
      return (
        <CheckCircle2Icon
          className="text-ok motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-50 motion-safe:[animation-duration:300ms]"
          data-testid="connection-success-icon"
        />
      )
    }

    if (connectTestResult?.success === false) {
      return (
        <XCircleIcon
          className="text-err motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-50 motion-safe:[animation-duration:300ms]"
          data-testid="connection-error-icon"
        />
      )
    }

    return null
  }, [isTestingConnection, connectTestResult])

  return {
    connectionTestIcon,
    handleTestConnection,
    isTestingConnection,
    resetConnectionTest
  }
}

interface ConnectionStringSectionProps {
  form: DatabaseFormApi
  onSslModeApplied: () => void
}

function ConnectionStringSection({
  form,
  onSslModeApplied
}: ConnectionStringSectionProps): ReactElement {
  const [connectionString, setConnectionString] = useState('')
  const [showConnectionString, setShowConnectionString] = useState(false)

  const handleApplyConnectionString = useCallback(() => {
    const parsed = parseConnectionString(connectionString)

    if (!parsed) {
      toast.error('Could not read that connection string', {
        description: 'Expected something like postgresql://user:pass@host/db'
      })

      return
    }

    if (parsed.host !== undefined) {
      form.setValue('connectionInfo.host', parsed.host)
    }

    if (parsed.port !== undefined) {
      form.setValue('connectionInfo.port', parsed.port)
    }

    if (parsed.database !== undefined) {
      form.setValue('connectionInfo.database', parsed.database)
    }

    if (parsed.username !== undefined) {
      form.setValue('connectionInfo.username', parsed.username)
    }

    if (parsed.password !== undefined) {
      form.setValue('connectionInfo.password', parsed.password)
    }

    if (parsed.sslMode) {
      form.setValue('connectionInfo.sslMode', parsed.sslMode)
      onSslModeApplied()
    }

    setConnectionString('')
    setShowConnectionString(false)
    toast.success('Connection details filled in')
  }, [connectionString, form, onSslModeApplied])

  if (!showConnectionString) {
    return (
      <button
        className="self-start text-xs text-accent underline-offset-4 hover:underline"
        type="button"
        onClick={() => setShowConnectionString(true)}
      >
        Have a connection string? Paste it
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-text2">
        Paste a connection string to fill in the fields below.
      </p>

      <div className="flex gap-2">
        <Input
          autoFocus
          className="flex-1 font-mono text-xs"
          placeholder="postgresql://user:password@host:5432/database"
          value={connectionString}
          onChange={(event) => setConnectionString(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              handleApplyConnectionString()
            }
          }}
        />

        <Button
          disabled={!connectionString.trim()}
          size="sm"
          type="button"
          onClick={handleApplyConnectionString}
        >
          Fill in
        </Button>
      </div>
    </div>
  )
}

interface ConnectionDetailsSectionProps {
  databaseType: DatabaseType
  form: DatabaseFormApi
  onBrowseFile: () => void
  onTypeChange: (newType: string) => void
}

function ConnectionDetailsSection({
  databaseType,
  form,
  onBrowseFile,
  onTypeChange
}: ConnectionDetailsSectionProps): ReactElement {
  return (
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
                  onValueChange={onTypeChange}
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
                  onClick={onBrowseFile}
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
                      placeholder={databaseType === 'mysql' ? '3306' : '5432'}
                      type="number"
                      name={field.name}
                      onBlur={field.onBlur}
                      ref={field.ref}
                      value={field.value == null ? '' : field.value}
                      onChange={(event) => {
                        const value = event.target.value

                        field.onChange(value === '' ? undefined : Number(value))
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
  )
}

function AuthenticationSection({
  form,
  isEditMode
}: {
  form: DatabaseFormApi
  isEditMode: boolean
}): ReactElement {
  const encryptionAvailable = useEncryptionAvailable()

  return (
    <FormSection>
      <FormSectionHeader>
        <FormSectionTitle text="Authentication" />
      </FormSectionHeader>

      <Separator />

      {!encryptionAvailable && (
        <p className="rounded-md border border-err-border bg-err-bg px-3 py-2 text-xs text-err">
          Your OS keychain is unavailable — this password will be stored
          unencrypted on this computer.
        </p>
      )}

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
                  placeholder={
                    isEditMode
                      ? 'Leave blank to keep current password'
                      : 'password'
                  }
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
  )
}

function SslSection({ form }: { form: DatabaseFormApi }): ReactElement {
  return (
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
                  <SelectItem value="verify-ca">Verify CA</SelectItem>
                  <SelectItem value="verify-full">Verify Full</SelectItem>
                </SelectContent>
              </Select>
              {field.value === 'require' && (
                <p className="text-xs text-muted-foreground">
                  Encrypts traffic but does not verify the server&apos;s
                  identity.
                </p>
              )}
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {['verify-ca', 'verify-full'].includes(
        form.watch('connectionInfo.sslMode') ?? ''
      ) && (
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
                Path to a CA certificate file, or <code>system</code> to use the
                OS trust store.
              </p>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
    </FormSection>
  )
}

interface DatabaseFormActionsProps {
  connectionTestIcon: ReactNode
  isLoading: boolean
  isSaving: boolean
  onCancel?: () => void
  onTestConnection: (event: React.FormEvent) => void
}

function DatabaseFormActions({
  connectionTestIcon,
  isLoading,
  isSaving,
  onCancel,
  onTestConnection
}: DatabaseFormActionsProps): ReactElement {
  return (
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
        onClick={onTestConnection}
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

interface ParsedConnectionString {
  database?: string
  host?: string
  password?: string
  port?: number
  sslMode?: SslMode
  username?: string
}

function parseConnectionString(value: string): ParsedConnectionString | null {
  const trimmed = value.trim()

  if (!trimmed) {
    return null
  }

  try {
    const url = new URL(trimmed)
    const database = decodeURIComponent(url.pathname.replace(/^\//, ''))

    return {
      database: database || undefined,
      host: url.hostname || undefined,
      password: url.password ? decodeURIComponent(url.password) : undefined,
      port: url.port ? Number(url.port) : undefined,
      sslMode: parseSslMode(url),
      username: url.username ? decodeURIComponent(url.username) : undefined
    }
  } catch {
    return null
  }
}

function parseSslMode(url: URL): SslMode | undefined {
  const value = url.searchParams.get('sslmode') ?? url.searchParams.get('ssl')

  if (
    value === 'disable' ||
    value === 'require' ||
    value === 'verify-ca' ||
    value === 'verify-full'
  ) {
    return value
  }

  return undefined
}

function applyServerFieldErrors(form: DatabaseFormApi, error: unknown): void {
  if (!(error instanceof ApiError) || !error.details) {
    return
  }

  const fieldErrors = errorDetailsToFormFieldErrors(error.details)

  for (const [field, { message }] of Object.entries(fieldErrors)) {
    form.setError(field as keyof FormInput, {
      message,
      type: 'server'
    })
  }
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
