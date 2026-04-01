import * as React from 'react'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

const Checkbox = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
        'peer h-4.5 w-4.5 shrink-0 rounded-sm border border-[#6B7280] bg-transparent transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#34D399]/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-[#34D399] data-[state=checked]:bg-[#34D399] data-[state=checked]:text-[#0f172a]',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
      <Check className="h-3.5 w-3.5" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))

Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }
