import { ReactElement } from 'react'

import { Button } from '@/components/ui/button'

export function StartPage(): ReactElement {
  const handleSignIn = async () => {
    await fetch('http://localhost:7847/auth/anthropic/initiate', {
      headers: {
        'Content-Type': 'application/json'
      },
      method: 'POST'
    })
  }

  return (
    <div className="p-4">
      <Button onClick={handleSignIn}>Sign in with Claude</Button>
    </div>
  )
}
