import { dialog } from 'electron'
import { Hono } from 'hono'

import { mainWindow } from '@/main'

export const folderRouter = new Hono()

folderRouter.get('/select', async (context) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  })

  console.log('Folder selection result:', result)

  if (result.canceled || result.filePaths.length === 0) {
    return context.json({ path: null })
  }

  return context.json({
    path: result.filePaths[0]
  })
})
