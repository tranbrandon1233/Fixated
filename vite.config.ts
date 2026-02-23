import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const authProxyTarget = (env.VITE_AUTH_PROXY_TARGET || 'http://127.0.0.1:5000').trim()

  return {
    plugins: [
      react({
        babel: {
          plugins: [['babel-plugin-react-compiler']],
        },
      }),
    ],
    server: {
      allowedHosts: true,
      proxy: {
        '/oauth': {
          target: authProxyTarget,
          changeOrigin: true,
          secure: false,
        },
        '/auth': {
          target: authProxyTarget,
          changeOrigin: true,
          secure: false,
        },
        '/api': {
          target: authProxyTarget,
          changeOrigin: true,
          secure: false,
        },
        '/health': {
          target: authProxyTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    preview: {
      allowedHosts: true,
    },
  }
})
