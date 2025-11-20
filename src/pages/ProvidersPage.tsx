import { ReactElement, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { log } from 'tiny-typescript-logger'

import { fetchProviders, upsertProvider } from '@/api-client'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ProviderDto, providerNames, providerTypes } from '@/glue/providers'
import { Skeleton } from '@/components/ui/skeleton'

export function ProvidersPage(): ReactElement {
  const [isLoading, setIsLoading] = useState(true)
  const [providers, setProviders] = useState<ProviderDto[]>([])
  const [isAddingProvider, setIsAddingProvider] = useState(false)

  const unConfiguredProviderTypes = providerTypes.filter(
    (type) => !providers.find((p) => p.type === type)
  )

  const navigate = useNavigate()

  useEffect(() => {
    fetchProviders()
      .then((newProviders) => {
        setProviders(newProviders)
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

  const handleAddProvider = async (providerType: string) => {
    log.info(`Add provider of type: ${providerType}`)

    setIsAddingProvider(true)

    try {
      const id = crypto.randomUUID()

      const provider = await upsertProvider(id, providerType)

      log.info(`Provider added with ID: ${provider.id}`)

      navigate(`/providers/${provider.id}`)
    } finally {
      setIsAddingProvider(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-8 p-6">
        <Skeleton className="h-8 w-48" />

        <div className="grid grid-cols-4 gap-4">
          <Skeleton className="h-9 w-[110px]" />
          <Skeleton className="h-9 w-[110px]" />
          <Skeleton className="h-9 w-[110px]" />
          <Skeleton className="h-9 w-[110px]" />
          <Skeleton className="h-9 w-[110px]" />
          <Skeleton className="h-9 w-[110px]" />
          <Skeleton className="h-9 w-[110px]" />
          <Skeleton className="h-9 w-[110px]" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8 p-6">
      {providers.length > 0 && (
        <>
          <div>
            <h2 className="font-medium text-xl mb-4">Your Providers</h2>

            <div className="grid grid-cols-4 gap-4">
              {providers.map((provider) => (
                <div key={provider.id}>
                  <Button
                    className="capitalize w-full"
                    disabled={isAddingProvider}
                    variant="outline"
                    asChild
                  >
                    <a href={`/providers/${provider.id}`}>
                      {providerNames[provider.type]}
                    </a>
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <Separator />
        </>
      )}

      <div>
        <h2 className="font-medium text-xl mb-4">Add Provider</h2>

        <div className="grid grid-cols-4 gap-4">
          {unConfiguredProviderTypes.map((providerType) => (
            <div key={providerType}>
              <Button
                className="capitalize w-full"
                disabled={isAddingProvider}
                variant="outline"
                onClick={() => handleAddProvider(providerType)}
              >
                {providerNames[providerType]}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
