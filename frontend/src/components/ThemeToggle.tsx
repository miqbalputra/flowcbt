import { useTheme } from '@/lib/theme'
import { IconMoon, IconSun } from '@/components/icons'

export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Aktifkan mode terang' : 'Aktifkan mode gelap'}
      title="Ganti tema"
      className="btn-ghost touch-target rounded-full w-11 h-11 !p-0"
    >
      {theme === 'dark' ? <IconSun size={16} /> : <IconMoon size={16} />}
    </button>
  )
}
