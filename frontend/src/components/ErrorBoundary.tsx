// ErrorBoundary global — crash render tidak boleh jadi layar putih putus asa.
// Menampilkan kartu damaikan dengan Aksi: Muat ulang / Kembali ke beranda.
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Bisa dipasangkan ke penyedia logging (observability PRD §6).
    console.error('Kesalahan tak terduga:', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="min-h-full flex items-center justify-center p-6">
        <div className="card max-w-sm w-full text-center space-y-3" role="alert">
          <div className="text-3xl" aria-hidden>😵</div>
          <div>
            <div className="font-bold">Terjadi kesalahan tak terduga</div>
            <div className="text-sm text-muted mt-1">
              Coba muat ulang halaman. Pengerjaan ujianmu yang sudah tersimpan tetap aman.
            </div>
            <div className="text-xs text-muted mt-1 break-all select-text">
              {this.state.error.message || String(this.state.error)}
            </div>
          </div>
          <div className="flex justify-center gap-2">
            <button className="btn-primary" onClick={() => location.reload()}>↻ Muat ulang</button>
            <button className="btn-ghost" onClick={() => { this.setState({ error: null }); location.assign('/dashboard') }}>
              Ke beranda
            </button>
          </div>
        </div>
      </div>
    )
  }
}
