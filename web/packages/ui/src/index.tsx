import React, { createContext, useContext, useEffect, useState } from 'react';
import './theme.css';
import { Icon, Logo, type IconName } from './icons';
export { Icon, Logo };
export type { IconName };

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
  const next = theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark';
  return (
    <button
      className="btn btn-ghost btn-sm"
      style={{ borderRadius: 999, padding: 0, width: 34, minHeight: 34, minWidth: 34, border: 'none' }}
      aria-label={`Ganti tema (sekarang: ${theme})`}
      title={`Tema: ${theme} — klik untuk ${next}`}
      onClick={() => setTheme(next)}
    >
      <Icon name={theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'monitor'} />
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

// ---- Skeleton loading (placeholder struktur konten saat query berjalan) ----
export function Skeleton({ w = '60%', h, style }: { w?: number | string; h?: number; style?: React.CSSProperties }) {
  return <span className="skeleton" style={{ width: w, height: h, ...style }} aria-hidden="true" />;
}

// Baris skeleton untuk daftar/kartu: container aria-busy agar screen reader tahu konten sedang dimuat.
export function SkeletonList({ rows = 4, gap = 10, height = 20 }: { rows?: number; gap?: number; height?: number }) {
  return (
    <div aria-busy="true" aria-live="polite" style={{ display: 'grid', gap }} data-testid="skeleton-list">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} w={`${100 - (i % 3) * 12}%`} h={height} />
      ))}
    </div>
  );
}

// Skeleton kartu statistik (dashboard): box + dua garis.
export function SkeletonCards({ count = 4, style }: { count?: number; style?: React.CSSProperties }) {
  return (
    <div aria-busy="true" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, ...style }} data-testid="skeleton-cards">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card" style={{ display: 'grid', gap: 8 }}>
          <Skeleton w="70%" h={13} />
          <Skeleton w="40%" h={26} />
        </div>
      ))}
    </div>
  );
}

// Skeleton baris tabel: sel mi ...
export function SkeletonTableRows({ cols = 5, rows = 5, style }: { cols?: number; rows?: number; style?: React.CSSProperties }) {
  return (
    <tbody aria-busy="true" style={style} data-testid="skeleton-rows">
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r}>{Array.from({ length: cols }, (_, c) => (
          <td key={c}><Skeleton w={c === 0 ? '70%' : '45%'} /></td>
        ))}</tr>
      ))}
    </tbody>
  );
}

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

// ---- Status koneksi (FR-7.7): tersinkron / menyinkronkan / offline (indikator dot + teks) ----
export function ConnectionBadge({ online, pending }: { online: boolean; pending: number }) {
  if (!online) return (
    <span className="badge badge-danger" title="Offline — jawaban tersimpan di perangkat">
      <span className="dot" aria-hidden="true" />Offline{pending > 0 && ` (${pending} menunggu)`}
    </span>
  );
  if (pending > 0) return (
    <span className="badge badge-warn" title="Menyinkronkan jawaban">
      <span className="dot pulse" aria-hidden="true" />Menyinkronkan ({pending})
    </span>
  );
  return (
    <span className="badge badge-ok" title="Online dan tersinkron">
      <span className="dot" aria-hidden="true" />Tersinkron
    </span>
  );
}

// Perilaku dialog: tutup dengan Esc + focus trap (Tab berputar di dalam dialog)
// + fokus awal ke kontainer dialog agar navigasi keyboard mulai dari sini.
function useDialogBehavior(open: boolean, onClose: () => void) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!open) return;
    const el = ref.current;
    const prev = document.activeElement as HTMLElement | null;
    el?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab' || !el) return;
      const focusables = el.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (focusables.length === 0) { e.preventDefault(); return; }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  return ref;
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const ref = useDialogBehavior(open, onClose);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><strong>{title}</strong><button className="btn btn-ghost btn-sm" style={{ border: 'none' }} onClick={onClose} aria-label="tutup"><Icon name="x" /></button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

// Bottom sheet untuk mobile (daftar soal) — FR-6.4.
export function BottomSheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const ref = useDialogBehavior(open, onClose);
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head"><strong>{title}</strong><button className="btn btn-ghost btn-sm" style={{ border: 'none' }} onClick={onClose} aria-label="tutup"><Icon name="x" /></button></div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

// ---- Helper halaman: header, kartu statistik, empty state ----
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <Card className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </Card>
  );
}

export function EmptyState({ icon = 'inbox', title, children }: { icon?: IconName; title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} />
      <div style={{ fontWeight: 600, color: 'var(--text)' }}>{title}</div>
      {children && <div style={{ fontSize: 14, marginTop: 4 }}>{children}</div>}
    </div>
  );
}
