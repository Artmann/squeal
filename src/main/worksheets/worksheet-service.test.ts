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
                  id: 'test-worksheet-id',
                  createdAt: new Date('2024-01-01'),
                  deletedAt: null,
                  name: 'Test Worksheet'
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

import { WorksheetService } from './worksheet-service'

describe('WorksheetService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createWorksheet', () => {
    it('should insert a worksheet with the provided name', async () => {
      const service = new WorksheetService()

      await service.createWorksheet('My Worksheet')

      expect(mockInsert).toHaveBeenCalled()
      expect(mockValues).toHaveBeenCalledWith({ name: 'My Worksheet' })
      expect(mockReturning).toHaveBeenCalled()
    })

    it('should return a transformed WorksheetDto', async () => {
      const service = new WorksheetService()

      const result = await service.createWorksheet('My Worksheet')

      expect(result).toEqual({
        createdAt: new Date('2024-01-01').getTime(),
        id: 'test-worksheet-id',
        name: 'Test Worksheet'
      })
    })
  })

  describe('listWorksheets', () => {
    it('should filter out soft-deleted worksheets', async () => {
      const service = new WorksheetService()

      await service.listWorksheets()

      expect(mockSelect).toHaveBeenCalled()
      expect(mockFrom).toHaveBeenCalled()
      expect(mockWhere).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'isNull' })
      )
    })
  })
})
