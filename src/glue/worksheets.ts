export interface CreateWorksheetRequest {
  content?: string
  databaseId?: string
  name: string
}

export interface WorksheetDto {
  content: string
  createdAt: number
  databaseId: string | null
  id: string
  lastOpenedAt: number | null
  name: string
  sortOrder: number | null
}
