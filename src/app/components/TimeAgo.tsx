import { ReactElement } from 'react'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { cn } from '@/app/lib/utils'

dayjs.extend(relativeTime)

interface TimeAgoProps {
  className?: string
  timestamp: number
}

export function TimeAgo({ className, timestamp }: TimeAgoProps): ReactElement {
  return <span className={cn(className)}>{dayjs(timestamp).fromNow()}</span>
}
