import { ReactElement } from 'react'
import dayjs from 'dayjs'
import localizedFormat from 'dayjs/plugin/localizedFormat'
import relativeTime from 'dayjs/plugin/relativeTime'
import { cn } from '@/app/lib/utils'

dayjs.extend(localizedFormat)
dayjs.extend(relativeTime)

interface TimeAgoProps {
  className?: string
  timestamp: number
}

export function TimeAgo({ className, timestamp }: TimeAgoProps): ReactElement {
  const time = dayjs(timestamp)

  return (
    <span
      className={cn(className)}
      title={time.format('lll')}
    >
      {time.fromNow()}
    </span>
  )
}
