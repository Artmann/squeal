import { DatabaseType, PublicConnectionInfo } from '@/databases/schemas'

export interface DatabaseDto {
  connectionInfo: PublicConnectionInfo
  createdAt: number
  id: string
  name: string
  type: DatabaseType
}
