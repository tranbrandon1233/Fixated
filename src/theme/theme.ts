export type ThemeMode = 'light' | 'dark'

const storageKey = 'fixated-theme'

export const getInitialTheme = (): ThemeMode => {
  if (typeof window === 'undefined') {
    return 'dark'
  }

  const stored = window.localStorage.getItem(storageKey)
  if (stored === 'light' || stored === 'dark') {
    return stored
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export const applyTheme = (mode: ThemeMode) => {
  document.documentElement.setAttribute('data-theme', mode)
  window.localStorage.setItem(storageKey, mode)
}
