import { useEffect, useState } from 'react'

type Theme = 'light' | 'dark'

const KEY = 'flowcbt.theme'

function initial(): Theme {
  const saved = localStorage.getItem(KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Tema dark/light — default mengikuti prefers-color-scheme, pilihan disimpan (FR-11.1) */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initial)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem(KEY, theme)
    const meta = document.querySelector('meta[name="theme-color"]')
    // sinkron dengan token styles.css: bg light/dark (bukan warna aksen)
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#1a2029' : '#f9fafb')
  }, [theme])
  return {
    theme,
    toggle: () => setTheme(t => (t === 'dark' ? 'light' : 'dark')),
    set: setTheme,
  }
}
