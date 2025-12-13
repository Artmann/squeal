import { ConnectionInfo, DatabaseType } from '@/databases/schemas'

export interface DatabaseDto {
  connectionInfo: ConnectionInfo
  createdAt: number
  id: string
  name: string
  type: DatabaseType
}
