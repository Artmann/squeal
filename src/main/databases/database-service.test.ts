import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSelect = vi.fn()
const mockFrom = vi.fn()
const mockWhere = vi.fn()
const mockInsert = vi.fn()
const mockValues = vi.fn()
const mockReturning = vi.fn()

vi.mock('@/database', () => ({
  database: {
    insert: () => {
      mockInsert()

      return {
        values: (data: unknown) => {
          mockValues(data)

          return {
            returning: () => {
              mockReturning()

              return [
                {
                  id: 'test-id',
                  connectionInfo: JSON.stringify({
                    database: 'testdb',
                    host: 'localhost',
                    password: 'secret',
                    port: 5432,
                    username: 'user'
                  }),
                  createdAt: new Date('2024-01-01'),
                  deletedAt: null,
                  lastUsedAt: null,
                  name: 'Test Database',
                  type: 'postgres'
                }
              ]
            }
          }
        }
      }
    },
    select: () => {
      mockSelect()

      return {
        from: () => {
          mockFrom()

          return {
            where: (condition: unknown) => {
              mockWhere(condition)

              return []
            }
          }
        }
      }
    }
  }
}))

vi.mock('drizzle-orm', () => ({
  isNull: vi.fn((column) => ({ type: 'isNull', column }))
}))

import { DatabaseService } from './database-service'

describe('DatabaseService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createDatabase', () => {
    it('should insert a database with serialized connection info', async () => {
      const service = new DatabaseService()
      const connectionInfo = {
        database: 'mydb',
        host: 'localhost',
        password: 'pass',
        port: 5432,
        username: 'admin'
      }

      await service.createDatabase('My Database', connectionInfo, 'postgres')

      expect(mockInsert).toHaveBeenCalled()
      expect(mockValues).toHaveBeenCalledWith({
        connectionInfo: JSON.stringify(connectionInfo),
        name: 'My Database',
        type: 'postgres'
      })
      expect(mockReturning).toHaveBeenCalled()
    })

    it('should return a transformed DatabaseDto', async () => {
      const service = new DatabaseService()
      const connectionInfo = {
        database: 'mydb',
        host: 'localhost',
        password: 'pass',
        port: 5432,
        username: 'admin'
      }

      const result = await service.createDatabase(
        'My Database',
        connectionInfo,
        'postgres'
      )

      expect(result).toEqual({
        connectionInfo: {
          database: 'testdb',
          host: 'localhost',
          password: 'secret',
          port: 5432,
          username: 'user'
        },
        createdAt: new Date('2024-01-01').getTime(),
        id: 'test-id',
        name: 'Test Database',
        type: 'postgres'
      })
    })
  })

  describe('listDatabases', () => {
    it('should filter out soft-deleted databases', async () => {
      const service = new DatabaseService()

      await service.listDatabases()

      expect(mockSelect).toHaveBeenCalled()
      expect(mockFrom).toHaveBeenCalled()
      expect(mockWhere).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'isNull' })
      )
    })
  })
})
