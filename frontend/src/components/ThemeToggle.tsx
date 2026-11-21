import { useTheme } from '@/lib/theme'
import { IconMoon, IconSun } from '@/components/icons'

/** Tombol tema. `tone="inverse"` untuk dipakai di atas permukaan gelap (appbar). */
export function ThemeToggle({ tone = 'default' }: { tone?: 'default' | 'inverse' }) {
  const { theme, toggle } = useTheme()
  const inverse = tone === 'inverse'
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Aktifkan mode terang' : 'Aktifkan mode gelap'}
      title="Ganti tema"
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-colors ${
        inverse
          ? 'border-ink-line bg-white/5 text-ink-fg hover:bg-white/10'
          : 'border-transparent text-muted hover:bg-canvas hover:text-text'
      }`}
    >
      {theme === 'dark' ? <IconSun size={17} /> : <IconMoon size={17} />}
    </button>
  )
}
