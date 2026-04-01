import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-gray-500 bg-gray-600/70 px-2.5 py-0.5 text-xs text-gray-100',
        className,
      )}
      {...props}
    />
  )
}
