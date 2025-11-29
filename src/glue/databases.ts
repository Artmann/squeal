import { PostgresConnectionInfo } from '@/databases/schemas'

export interface DatabaseDto {
  connectionInfo: PostgresConnectionInfo
  createdAt: number
  id: string
  name: string
  type: string
}
