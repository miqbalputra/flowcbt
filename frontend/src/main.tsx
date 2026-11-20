import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ToastProvider } from './components/toast'
import './styles.css'

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      // Ulang hanya bila gagal jaringan/server (status 0/5xx) — 4xx bukan
      // kesalahan yang bisa pulang dengan dicoba lagi.
      retry: (failureCount, error) => {
        const status = (error as { status?: number } | null)?.status ?? 0
        return status !== 400 && status !== 401 && status !== 403 && status !== 404 && failureCount < 1
      },
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <ErrorBoundary>
          <ToastProvider>
            <App />
          </ToastProvider>
        </ErrorBoundary>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
