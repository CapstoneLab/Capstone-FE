export {}

declare global {
  interface Window {
    desktop?: {
      app?: string
      window?: {
        minimize?: () => void
        toggleMaximize?: () => void
        close?: () => void
        isMaximized?: () => Promise<boolean>
        onMaximizedChange?: (callback: (isMaximized: boolean) => void) => () => void
      }
    }
  }
}
