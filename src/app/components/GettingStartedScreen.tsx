import { zodResolver } from '@hookform/resolvers/zod'
import { CheckCircle2Icon } from 'lucide-react'
import { ReactElement, useCallback, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { CreateConnectionTestResponse } from '@/databases'
import {
  createDatabaseSchema,
  CreateDatabaseRequest,
  PostgresConnectionInfo
} from '@/databases/schemas'
import { ApiError } from '@/errors'
import { DatabaseDto } from '@/glue/databases'
import { WorksheetDto } from '@/glue/worksheets'
import { useAppDispatch } from '../store'
import { databaseAdded, worksheetUpdated } from '../store/editor-slice'
import { uiActions } from '../store/ui-slice'
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
import { Alert, AlertDescription, AlertTitle } from './ui/alert'

async function testConnection(
  info: PostgresConnectionInfo
): Promise<{ message?: string; success: boolean }> {
  const response = await fetch(`http://localhost:7847/connection-tests`, {
    body: JSON.stringify({
      connectionInfo: info
    }),
    headers: {
      'Content-Type': 'application/json'
    },
    method: 'POST'
  })

  const data = await response.json()

  if ('error' in data) {
    throw new ApiError(
      data.error.message,
      data.error.status,
      data.error.details
    )
  }

  return data as CreateConnectionTestResponse
}

interface CreateDatabaseResponse {
  database: DatabaseDto
  updatedWorksheet?: WorksheetDto
}

async function saveDatabase(
  request: CreateDatabaseRequest
): Promise<CreateDatabaseResponse> {
  const response = await fetch('http://localhost:7847/databases', {
    body: JSON.stringify(request),
    headers: {
      'Content-Type': 'application/json'
    },
    method: 'POST'
  })

  const data = await response.json()

  if ('error' in data) {
    throw new ApiError(
      data.error.message,
      data.error.status,
      data.error.details
    )
  }

  return data as CreateDatabaseResponse
}

type FormInput = z.input<typeof createDatabaseSchema>
type FormOutput = z.output<typeof createDatabaseSchema>

export function GettingStartedScreen(): ReactElement {
  const dispatch = useAppDispatch()

  const form = useForm<FormInput, unknown, FormOutput>({
    defaultValues: {
      name: '',
      connectionInfo: {
        database: '',
        host: '',
        password: '',
        port: '',
        username: ''
      }
    },
    resolver: zodResolver(createDatabaseSchema)
  })

  const [connectTestResult, setConnectTestResult] = useState<
    CreateConnectionTestResponse | undefined
  >()
  const [isSaving, setIsSaving] = useState(false)
  const [isTestingConnection, setIsTestingConnection] = useState(false)

  const connectionInfo = form.watch('connectionInfo')

  const handleSubmit = useCallback((values: CreateDatabaseRequest) => {
    form.clearErrors()
    setIsSaving(true)

    saveDatabase(values)
      .then(({ database, updatedWorksheet }) => {
        toast.success('Database saved!', {
          description: `${database.name} has been added.`
        })

        dispatch(databaseAdded(database))

        if (updatedWorksheet) {
          dispatch(worksheetUpdated(updatedWorksheet))
        }

        dispatch(uiActions.gettingStartedCompleted())
      })
      .catch((error) => {
        console.error('Save database error:', error)

        toast.error('Failed to save database', { description: error.message })

        form.setError('root', { message: error.message })

        if (error instanceof ApiError && error.details) {
          const fieldErrors = errorDetailsToFormFieldErrors(error.details)

          for (const [field, { message }] of Object.entries(fieldErrors)) {
            form.setError(field as any, { message, type: 'server' })
          }
        }
      })
      .finally(() => {
        setIsSaving(false)
      })
  }, [])

  const handleTestConnection = useCallback((e: React.FormEvent) => {
    e.preventDefault()

    console.log('Testing connection', connectionInfo)

    form.clearErrors()

    setIsTestingConnection(true)
    setConnectTestResult(undefined)

    testConnection({
      ...connectionInfo,
      port: Number(connectionInfo.port) || 5432
    })
      .then((result) => {
        if (result.success) {
          console.log('Connection successful!')

          toast.success('Connection successful!')
        } else {
          console.error('Connection failed:', result.message)

          toast.error('Connection failed', { description: result.message })
        }

        setConnectTestResult(result)
      })
      .catch((error) => {
        console.error('Connection test error:', error)

        toast.error('Connection test failed', { description: error.message })

        form.setError('root', { message: error.message })

        if (error instanceof ApiError && error.details) {
          console.log('Validation errors:', error.details)

          const fieldErrors = errorDetailsToFormFieldErrors(error.details)

          for (const [field, { message }] of Object.entries(fieldErrors)) {
            form.setError(field as any, { message, type: 'server' })
          }
        }
      })
      .finally(() => {
        setIsTestingConnection(false)
      })
  }, [])

  return (
    <div className="fixed inset-0 z-100 bg-mantle flex justify-center items-center">
      <div className="w-full max-w-md flex flex-col gap-6">
        <div>
          <h1 className="text-3xl font-semibold mb-2">Welcome 👋</h1>

          <p>Connect your first database to get started.</p>
        </div>

        <div>
          <Form {...form}>
            <form
              className="flex flex-col gap-4"
              onSubmit={form.handleSubmit(handleSubmit)}
            >
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
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
                          placeholder="5439"
                          type="number"
                          {...field}
                          value={String(field.value ?? '')}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

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
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {connectTestResult && connectTestResult.success === true && (
                <Alert>
                  <CheckCircle2Icon />
                  <AlertTitle>
                    Success! We were able to connect to your database.
                  </AlertTitle>
                </Alert>
              )}

              {connectTestResult && connectTestResult.success === false && (
                <Alert variant="destructive">
                  <CheckCircle2Icon />
                  <AlertTitle>Unable to connect to your database.</AlertTitle>
                  <AlertDescription>
                    <p>{connectTestResult.message}</p>
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex justify-end gap-3 py-4">
                <Button
                  disabled={isSaving || isTestingConnection}
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={handleTestConnection}
                >
                  {isTestingConnection ? 'Testing...' : 'Test Connection'}
                </Button>

                <Button
                  disabled={isSaving || isTestingConnection}
                  size="sm"
                  type="submit"
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </Button>
              </div>
            </form>
          </Form>
        </div>
      </div>
    </div>
  )
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
