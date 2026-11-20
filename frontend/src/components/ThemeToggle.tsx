import { useTheme } from '@/lib/theme'

export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  return (
    <button
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Aktifkan mode terang' : 'Aktifkan mode gelap'}
      title="Ganti tema"
      className="btn-ghost touch-target rounded-full w-11 h-11 !p-0"
    >
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  )
}
