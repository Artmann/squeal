import dayjs from 'dayjs'
import { ReactElement } from 'react'

import type { WorksheetMessage } from '../hooks/use-worksheet-messages'

export function QueryMessages({
  messages
}: {
  messages: WorksheetMessage[]
}): ReactElement {
  if (messages.length === 0) {
    return (
      <div className="px-4 py-3 font-mono text-[12px] text-text3">
        No messages yet
      </div>
    )
  }

  return (
    <div className="px-4 py-3 font-mono text-[12px] leading-[1.9]">
      {messages.map((message) => (
        <div
          className="flex gap-[14px]"
          key={message.id}
        >
          <span className="flex-none text-text3">
            {dayjs(message.timestamp).format('HH:mm:ss')}
          </span>

          <span className="min-w-0 break-words text-text2">{message.text}</span>
        </div>
      ))}
    </div>
  )
}
