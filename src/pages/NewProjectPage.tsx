import { ReactElement, useState } from 'react'

import { Separator } from '@/components/ui/separator'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export function NewProjectPage(): ReactElement {
  const [projectPath, setProjectPath] = useState('')

  const selectFolder = async (): Promise<string | null> => {
    const response = await fetch('http://localhost:7847/folders/select', {
      headers: {
        'Content-Type': 'application/json'
      }
    })

    const data = await response.json()

    return data.path
  }

  return (
    <div className="p-6 flex flex-col gap-8">
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-medium">Create Project from Scratch</h1>

        <div>
          <Label className="mb-2">Start with a prompt</Label>
          <Textarea className="h-32" />
        </div>

        <div>
          <Label className="mb-2">Project path</Label>

          <div className="flex items-center gap-2">
            <Input
              className="w-full"
              value={projectPath}
              onChange={(e) => setProjectPath(e.currentTarget.value)}
            />
            <Button
              size="sm"
              onClick={(e) => {
                e.preventDefault()

                selectFolder().then((path) => path && setProjectPath(path))
              }}
            >
              Open Folder
            </Button>
          </div>
        </div>
      </div>

      <Separator />

      <div className="flex flex-col gap-6">
        <h2 className="text-xl font-medium">Or open an existing project</h2>

        <div>
          <Label className="mb-2">Project path</Label>

          <div className="flex items-center gap-2">
            <Input
              className="w-full"
              value={projectPath}
              onChange={(e) => setProjectPath(e.currentTarget.value)}
            />
            <Button
              size="sm"
              onClick={(e) => {
                e.preventDefault()

                selectFolder().then((path) => path && setProjectPath(path))
              }}
            >
              Open Folder
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
