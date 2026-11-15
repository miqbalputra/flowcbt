import React, { createContext, useContext, useEffect, useState } from 'react';
import './theme.css';

// ---- Tema (dark/light/system) — FR-11.1 ----
type Theme = 'light' | 'dark' | 'system';
const ThemeCtx = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({ theme: 'system', setTheme: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => (localStorage.getItem('flowcbt-theme') as Theme) || 'system');
  const setTheme = (t: Theme) => {
    setThemeState(t);
    localStorage.setItem('flowcbt-theme', t);
  };
  useEffect(() => {
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.classList.toggle('dark', dark);
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  return <ThemeCtx.Provider value={{ theme, setTheme }}>{children}</ThemeCtx.Provider>;
}

export function useTheme() { return useContext(ThemeCtx); }

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <button
      className="btn"
      aria-label="Ganti tema"
      onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark')}
      title={`Tema: ${theme}`}
    >
      {theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '🖥️'}
    </button>
  );
}

// ---- Komponen dasar ----
export function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  const v = props.variant || 'primary';
  return <button {...props} className={`btn btn-${v} ${props.className || ''}`} disabled={props.disabled} />;
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`input ${props.className || ''}`} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`input ${props.className || ''}`} />;
}

export function Card({ children, className = '', style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return <div className={`card ${className}`} style={style}>{children}</div>;
}

export function Badge({ children, tone = 'brand' }: { children: React.ReactNode; tone?: 'brand' | 'ok' | 'warn' | 'danger' | 'muted' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Spinner() { return <span className="spinner" aria-label="memuat" />; }

// ---- Toast ----
const ToastCtx = createContext<(msg: string, tone?: 'ok' | 'danger' | 'muted') => void>(() => {});
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string; tone: string }[]>([]);
  const push = (msg: string, tone: 'ok' | 'danger' | 'muted' = 'muted') => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, msg, tone }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4000);
  };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap" role="status">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>{t.msg}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export function useToast() { return useContext(ToastCtx); }

// ---- Status koneksi (FR-7.7): 🟢 tersinkron / 🟡 menyinkronkan / 🔴 offline ----
export function ConnectionBadge({ online, pending }: { online: boolean; pending: number }) {
  if (!online) return <span className="badge badge-danger" title="Offline — jawaban tersimpan di perangkat">🔴 Offline ({pending})</span>;
  if (pending > 0) return <span className="badge badge-warn" title="Menyinkronkan">🟡 Menyinkronkan ({pending})</span>;
  return <span className="badge badge-ok" title="Online & tersinkron">🟢 Tersinkron</span>;
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><strong>{title}</strong><button className="btn btn-ghost" onClick={onClose} aria-label="tutup">✕</button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

// Bottom sheet untuk mobile (daftar soal) — FR-6.4.
export function BottomSheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><strong>{title}</strong><button className="btn btn-ghost" onClick={onClose}>✕</button></div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
