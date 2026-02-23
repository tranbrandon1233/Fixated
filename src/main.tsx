import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'

const NGROK_BYPASS_HEADER = 'ngrok-skip-browser-warning'
const NGROK_BYPASS_VALUE = 'true'

const isNgrokHost = (hostname: string) => {
  const normalized = hostname.toLowerCase()
  return (
    normalized.endsWith('.ngrok-free.app')
    || normalized.endsWith('.ngrok.app')
    || normalized.endsWith('.ngrok.io')
  )
}

const resolveRequestUrl = (input: RequestInfo | URL) => {
  if (input instanceof Request) return input.url
  return typeof input === 'string' ? input : input.toString()
}

const installNgrokBypassHeader = () => {
  const originalFetch = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    let requestUrl = ''
    try {
      requestUrl = new URL(resolveRequestUrl(input), window.location.href).toString()
    } catch {
      return originalFetch(input, init)
    }

    if (!isNgrokHost(new URL(requestUrl).hostname)) {
      return originalFetch(input, init)
    }

    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    if (!headers.has(NGROK_BYPASS_HEADER)) {
      headers.set(NGROK_BYPASS_HEADER, NGROK_BYPASS_VALUE)
    }

    return originalFetch(input, { ...init, headers })
  }
}

installNgrokBypassHeader()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
