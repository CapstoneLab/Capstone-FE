import { Globe2 } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useLanguage } from '@/contexts/LanguageContext'
import type { Locale } from '@/i18n/translations'
import { cn } from '@/lib/utils'

type LanguageSelectProps = {
  compact?: boolean
}

const languageIcons: Record<Locale, string> = {
  ko: '한',
  en: 'EN',
}

export function LanguageSelect({ compact = false }: LanguageSelectProps) {
  const { locale, setLocale, localeLabels, t } = useLanguage()
  const languageLabel = `${t('common.language')}: ${localeLabels[locale]}`

  return (
    <div className="flex items-center gap-1.5">
      {!compact ? <Globe2 className="h-4 w-4 text-[#9CA3AF]" aria-hidden="true" /> : null}
      <Select value={locale} onValueChange={(value) => setLocale(value as Locale)}>
        <SelectTrigger
          className={cn(
            'border-gray-500 bg-gray-700/70 text-gray-50',
            compact
              ? 'h-7 w-8 rounded-lg border-transparent bg-transparent px-1.5 text-[#064E3B] shadow-none hover:bg-transparent dark:text-[#A7F3D0] dark:hover:bg-transparent'
              : 'h-9 w-28',
          )}
          aria-label={languageLabel}
          title={languageLabel}
        >
          {compact ? (
            <span className="grid h-5 min-w-5 place-items-center px-1 text-[10px] font-black leading-none text-[#047857] dark:text-[#A7F3D0]">
              {languageIcons[locale]}
            </span>
          ) : (
            <SelectValue>
              <span className="inline-flex items-center gap-1.5">
                <span className="grid h-4 min-w-4 place-items-center rounded bg-emerald-400/15 px-1 text-[10px] font-black leading-none text-emerald-300">
                  {languageIcons[locale]}
                </span>
                <span>{localeLabels[locale]}</span>
              </span>
            </SelectValue>
          )}
          {!compact ? null : (
            <span className="sr-only">{localeLabels[locale]}</span>
          )}
        </SelectTrigger>
        <SelectContent>
          {Object.entries(localeLabels).map(([value, label]) => (
            <SelectItem key={value} value={value}>
              <span className="inline-flex items-center gap-2">
                <span className="grid h-4 min-w-4 place-items-center rounded bg-[#D1FAE5] px-1 text-[10px] font-black leading-none text-[#047857] ring-1 ring-[#10B981]/30 dark:bg-[#064E3B] dark:text-[#A7F3D0] dark:ring-[#34D399]/30">
                  {languageIcons[value as Locale]}
                </span>
                {label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
