/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react'
import { defaultMessages, localeLabels, type Locale, type Messages } from '@/i18n/translations'

const STORAGE_KEY = 'secupipeline:locale'
const N8N_I18N_WEBHOOK_URL = import.meta.env.VITE_N8N_I18N_WEBHOOK_URL as string | undefined

type LanguageContextValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
  localeLabels: Record<Locale, string>
  t: (key: string, replacements?: Record<string, string | number>) => string
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

function isLocale(value: string | null): value is Locale {
  return value === 'ko' || value === 'en'
}

function readInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'ko'

  const saved = window.localStorage.getItem(STORAGE_KEY)
  if (isLocale(saved)) return saved

  const browserLocale = window.navigator.language.toLowerCase()
  return browserLocale.startsWith('en') ? 'en' : 'ko'
}

function isStringRecord(value: unknown): value is Messages {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every((entry) => typeof entry === 'string')
  )
}

function normalizeRemoteMessages(payload: unknown, locale: Locale): Messages {
  if (!payload || typeof payload !== 'object') return {}

  const data = payload as Record<string, unknown>
  const candidates = [data[locale], data.messages, data.translations, data]

  for (const candidate of candidates) {
    if (isStringRecord(candidate)) {
      return candidate
    }
  }

  return {}
}

export function LanguageProvider({ children }: PropsWithChildren) {
  const [locale, setLocaleState] = useState<Locale>(readInitialLocale)
  const [remoteMessages, setRemoteMessages] = useState<Partial<Record<Locale, Messages>>>({})

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale)
    window.localStorage.setItem(STORAGE_KEY, nextLocale)
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  useEffect(() => {
    if (!N8N_I18N_WEBHOOK_URL) return

    const controller = new AbortController()
    const url = new URL(N8N_I18N_WEBHOOK_URL, window.location.origin)
    url.searchParams.set('locale', locale)

    fetch(url, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: unknown) => {
        const messages = normalizeRemoteMessages(payload, locale)
        if (Object.keys(messages).length === 0) return

        setRemoteMessages((prev) => ({
          ...prev,
          [locale]: {
            ...prev[locale],
            ...messages,
          },
        }))
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        console.warn('[LanguageProvider] Failed to load n8n translations', error)
      })

    return () => controller.abort()
  }, [locale])

  const messages = useMemo(
    () => ({
      ...defaultMessages[locale],
      ...(remoteMessages[locale] ?? {}),
    }),
    [locale, remoteMessages],
  )

  const t = useCallback(
    (key: string, replacements: Record<string, string | number> = {}) => {
      const template = messages[key] ?? defaultMessages.en[key] ?? key
      return Object.entries(replacements).reduce(
        (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
        template,
      )
    },
    [messages],
  )

  const value = useMemo(
    () => ({ locale, setLocale, localeLabels, t }),
    [locale, setLocale, t],
  )

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (!context) {
    throw new Error('useLanguage must be used within LanguageProvider')
  }
  return context
}
