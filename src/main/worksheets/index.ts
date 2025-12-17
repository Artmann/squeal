import { Hono } from 'hono'
import invariant from 'tiny-invariant'
import { z } from 'zod'

import { ValidationError } from '@/errors'
import { WorksheetDto } from '@/glue/worksheets'
import { WorksheetService } from './worksheet-service'

export const worksheetRouter = new Hono()

const worksheetService = new WorksheetService()

export interface CreateWorksheetResponse {
  worksheet: WorksheetDto
}

export interface UpdateWorksheetResponse {
  worksheet: WorksheetDto
}

const createWorksheetSchema = z.object({
  name: z.string()
})

const updateWorksheetSchema = z.object({
  content: z.string().optional(),
  databaseId: z.string().nullable().optional(),
  name: z.string().optional()
})

worksheetRouter.post('/', async (context) => {
  const body = await context.req.json()
  const result = await createWorksheetSchema.safeParseAsync(body)

  if (!result.success) {
    throw new ValidationError(result.error)
  }

  const worksheet = await worksheetService.createWorksheet(result.data.name)

  const response: CreateWorksheetResponse = {
    worksheet
  }

  return context.json(response, 201)
})

worksheetRouter.patch('/:id', async (context) => {
  const { id } = context.req.param()

  invariant(id, 'Worksheet ID is required')

  const body = await context.req.json()
  const result = await updateWorksheetSchema.safeParseAsync(body)

  if (!result.success) {
    throw new ValidationError(result.error)
  }

  const worksheet = await worksheetService.updateWorksheet(id, result.data)

  const response: UpdateWorksheetResponse = {
    worksheet
  }

  return context.json(response)
})
