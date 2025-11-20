import { FormEvent, ReactElement, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { log } from 'tiny-typescript-logger'

import { fetchProviders, upsertProvider } from '@/api-client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { ProviderDto, providerNames } from '@/glue/providers'

export function ProviderPage(): ReactElement {
  const { id } = useParams<{ id: string }>()

  console.log({ id })

  const [isLoading, setIsLoading] = useState(true)
  const [providers, setProviders] = useState<ProviderDto[]>([])
  const [isUpdatingProvider, setIsUpdatingProvider] = useState(false)
  const [token, setToken] = useState('')

  const provider = providers.find((p) => p.id === id)
  const isDisabled = isLoading || isUpdatingProvider

  const navigate = useNavigate()

  useEffect(() => {
    fetchProviders()
      .then((newProviders) => {
        setProviders(newProviders)

        const provider = newProviders.find((p) => p.id === id)

        if (provider) {
          setToken(provider.token)
        }

        setIsLoading(false)
      })
      .catch((error) => {
        const errorMessage =
          error instanceof Error ? error.message : String(error)

        log.error(`Failed to fetch providers: ${errorMessage}`)

        toast.error('Failed to load providers.', {
          description: errorMessage
        })

        setIsLoading(false)
      })
  }, [])

  if (!provider) {
    return <div className="p-6">Provider not found.</div>
  }

  const handleCancel = (e: FormEvent) => {
    e.preventDefault()

    if (isDisabled) {
      return
    }

    navigate('/providers')
  }

  const handleUpdateProvider = async (providerType: string) => {
    if (isDisabled) {
      return
    }

    log.info(`Update provider with id: ${id} of type: ${providerType}.`)

    setIsUpdatingProvider(true)

    try {
      const provider = await upsertProvider(id, providerType, token)

      log.info(`Provider updated with ID: ${provider.id}.`)

      navigate(`/providers`)
    } finally {
      setIsUpdatingProvider(false)
    }
  }

  return (
    <div className="flex flex-col gap-8 p-6">
      <div>
        <h2 className="font-medium text-xl mb-1">Configure Provider</h2>
        <div className="text-muted-foreground">
          {providerNames[provider.type]}
        </div>
      </div>

      <div className="w-full">
        <form
          className="w-full max-w-lg space-y-6"
          aria-disabled={isDisabled}
          onSubmit={(e) => {
            e.preventDefault()

            handleUpdateProvider(provider.type)
          }}
        >
          <div className="w-full">
            <Label
              className="mb-2 block"
              htmlFor="token"
            >
              Token
            </Label>
            <Input
              className="w-full"
              disabled={isDisabled}
              id="token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button
              disabled={isDisabled}
              variant="outline"
              onClick={handleCancel}
            >
              Cancel
            </Button>
            <Button
              disabled={isDisabled}
              type="submit"
            >
              Save
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
