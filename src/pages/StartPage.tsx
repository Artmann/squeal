import { Button } from '@/components/ui/button'
import { ReactElement } from 'react'

export function StartPage(): ReactElement {
  return (
    <div className="p-4">
      <Button asChild>
        <a href="#">Sign in with Claude</a>
      </Button>
    </div>
  )
}
