import { ReactElement } from 'react'

import { getRunShortcut } from '../run-shortcut'

export function QueryResultEmpty(): ReactElement {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-[10px] text-center">
      <div className="flex size-[38px] items-center justify-center rounded-full border-[1.5px] border-border text-text3">
        <svg
          aria-hidden="true"
          className="ml-[2px]"
          fill="currentColor"
          height="13"
          viewBox="0 0 12 12"
          width="13"
        >
          <path d="M2.5 1.2 10 6l-7.5 4.8z" />
        </svg>
      </div>

      <p className="text-[13px] font-medium text-text2">No results yet</p>

      <p className="text-[12px] text-text3">
        Press {getRunShortcut()} or click Run to execute this worksheet
      </p>
    </div>
  )
}
