import { ReactNode, useEffect } from 'react'

import { apiClient } from './api-client'
import { useAppDispatch, useAppSelector } from './store'
import { schemaFetched } from './store/editor-slice'

export function AppLoader({ children }: { children: ReactNode }): ReactNode {
  const dispatch = useAppDispatch()
  const databases = useAppSelector((state) => state.editor.databases)

  useEffect(() => {
    async function loadSchemas() {
      for (const database of databases) {
        try {
          const schema = await apiClient.getDatabaseSchema(database.id)

          dispatch(schemaFetched({ databaseId: database.id, schema }))
        } catch (error) {
          console.error(`Failed to load schema for database ${database.id}:`, error)
        }
      }
    }

    loadSchemas()
  }, [databases, dispatch])

  return children
}
