import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-xl border border-gray-600/80 bg-gray-700/55 backdrop-blur-sm', className)}
      {...props}
    />
  )
}
