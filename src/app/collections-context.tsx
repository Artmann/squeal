import { createContext, ReactNode, useContext } from 'react'
import invariant from 'tiny-invariant'

import { Collections } from './collections'

const CollectionsContext = createContext<Collections | undefined>(undefined)

interface CollectionsProviderProps {
  children: ReactNode
  collections: Collections
}

export function CollectionsProvider({
  children,
  collections
}: CollectionsProviderProps): ReactNode {
  return (
    <CollectionsContext.Provider value={collections}>
      {children}
    </CollectionsContext.Provider>
  )
}

export function useCollections(): Collections {
  const collections = useContext(CollectionsContext)

  invariant(
    collections,
    'useCollections must be used within a CollectionsProvider'
  )

  return collections
}
