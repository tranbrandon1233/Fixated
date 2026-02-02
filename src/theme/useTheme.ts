import { useEffect, useState } from 'react'
import { applyTheme, getInitialTheme, type ThemeMode } from './theme'

export const useTheme = () => {
  const [mode, setMode] = useState<ThemeMode>(() => getInitialTheme())

  useEffect(() => {
    applyTheme(mode)
  }, [mode])

  return {
    mode,
    setMode,
    toggle: () => setMode((prev) => (prev === 'dark' ? 'light' : 'dark')),
  }
}
