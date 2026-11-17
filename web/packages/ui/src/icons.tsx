// Ikon inline (stroke) — tanpa emoji, konsisten, aman offline (tak ada CDN/dependensi).
import React from 'react';

export type IconName =
  | 'dashboard' | 'students' | 'classes' | 'bank' | 'exams' | 'report'
  | 'billing' | 'settings' | 'shield' | 'logout' | 'sun' | 'moon' | 'monitor'
  | 'plus' | 'search' | 'download' | 'upload' | 'clock' | 'flag' | 'check'
  | 'x' | 'chevron-left' | 'chevron-right' | 'list' | 'wifi' | 'wifi-off'
  | 'copy' | 'edit' | 'trash' | 'users' | 'calendar' | 'trophy' | 'play'
  | 'key' | 'inbox' | 'alert' | 'camera' | 'trend'
  | 'user' | 'info' | 'doc' | 'pause' | 'refresh' | 'pencil' | 'zap' | 'alert-triangle' | 'school' | 'square';

// A-16: ikon kembar sebelumnya didefinisikan dua kali dengan path identik.
const PENCIL_ICON = <><path d="M17 3.5a2.4 2.4 0 0 1 3.5 3.5L8 19.5 3 21l1.5-5L17 3.5Z"/></>;
const ALERT_ICON = <><path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 10v4.5M12 17.5h.01"/></>;

const paths: Record<IconName, React.ReactNode> = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></>,
  students: <><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5"/><circle cx="17.5" cy="9" r="2.5"/><path d="M16 15.2c2.8.2 4.8 1.7 5.5 4.3"/></>,
  classes: <><path d="M3 9.5 12 4l9 5.5-9 5.5-9-5.5Z"/><path d="M7 12v4.5c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5V12"/></>,
  bank: <><path d="M4 4h16v16H4z" fill="none"/><path d="M4 8h16M8 4v16M4 12h16M12 4v16M4 16h16M8 12h8"/></>,
  exams: <><path d="M8 3.5h8a1.5 1.5 0 0 1 1.5 1.5v15a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V5A1.5 1.5 0 0 1 8 3.5Z"/><path d="M9.5 8h5M9.5 12h5M9.5 16h3"/></>,
  report: <><path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/></>,
  billing: <><rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M2.5 10h19M6 14.5h4"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/></>,
  shield: <><path d="M12 2.5 4.5 5.5v6C4.5 16 8.5 20.5 12 21.5c3.5-1 7.5-5.5 7.5-10v-6L12 2.5Z"/></>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/></>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
  moon: <><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/></>,
  monitor: <><rect x="2.5" y="4" width="19" height="12.5" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/></>,
  plus: <><path d="M12 5v14M5 12h14"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.5-4.5"/></>,
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/></>,
  upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 8 5-5 5 5M12 3v12"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  flag: <><path d="M5 21V4.5"/><path d="M5 4.5C7 3 9 3 12 4.5s5 1.5 7 .5V14c-2 1-4 1-7-.5S7 12 5 13.5"/></>,
  check: <><path d="m4.5 12.5 5 5 10-11"/></>,
  x: <><path d="M6 6l12 12M18 6 6 18"/></>,
  'chevron-left': <><path d="m14.5 6-6 6 6 6"/></>,
  'chevron-right': <><path d="m9.5 6 6 6-6 6"/></>,
  list: <><path d="M8.5 6h12M8.5 12h12M8.5 18h12M4 6h.01M4 12h.01M4 18h.01"/></>,
  wifi: <><path d="M2.5 9a14.5 14.5 0 0 1 19 0M5.5 12.5a10 10 0 0 1 13 0M8.5 16a5.4 5.4 0 0 1 7 0"/><circle cx="12" cy="19.3" r="1.1"/></>,
  'wifi-off': <><path d="M2.5 9a14.5 14.5 0 0 1 5.2-3.4M11.5 5.1A14.5 14.5 0 0 1 21.5 9M5.5 12.5a10 10 0 0 1 4.9-2.6M14.7 11a10 10 0 0 1 3.8 1.5M8.5 16a5.4 5.4 0 0 1 5.6-.9"/><path d="M12 19.3h.01M3 3l18 18"/></>,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>,
  edit: PENCIL_ICON,
  trash: <><path d="M3.5 6.5h17M8.5 6.5V4.8A1.3 1.3 0 0 1 9.8 3.5h4.4a1.3 1.3 0 0 1 1.3 1.3v1.7M18.5 6.5l-.8 13a1.8 1.8 0 0 1-1.8 1.7H8.1a1.8 1.8 0 0 1-1.8-1.7l-.8-13"/></>,
  users: <><circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5"/><path d="M16 4a3.5 3.5 0 0 1 0 7"/></>,
  calendar: <><rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M3.5 10h17M8 2.5V7M16 2.5V7"/></>,
  trophy: <><path d="M8 21h8M12 17v4M6.5 4h11v5a5.5 5.5 0 0 1-11 0V4Z"/><path d="M6.5 6H4a2 2 0 0 0 2 5M17.5 6H20a2 2 0 0 1-2 5"/></>,
  play: <><path d="M7 4.5v15l12-7.5-12-7.5Z"/></>,
  key: <><circle cx="7.5" cy="16" r="4.5"/><path d="m11 12.5 9.5-9.5M17 6.5l3 3M14.5 9l2 2"/></>,
  inbox: <><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.5 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.5A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.5Z"/></>,
  alert: ALERT_ICON,
  camera: <><path d="M2.5 7.5A2 2 0 0 1 4.5 5.5h2l1.7-2h7.6l1.7 2h2a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2v-10.5Z"/><circle cx="12" cy="12.5" r="3.5"/></>,
  trend: <><path d="m3 16.5 6-6 4 4 8-8.5"/><path d="M15.5 6H21v5.5"/></>,
  user: <><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.2 3.7-5 7-5s6.2 1.8 7 5"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></>,
  doc: <><path d="M6 2.5h8l4 4V21.5H6V2.5Z"/><path d="M14 2.5V7h4M9 12h6M9 16h6"/></>,
  pause: <><rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/></>,
  refresh: <><path d="M20 11a8 8 0 1 0-2.3 6.3"/><path d="M20 4v7h-7"/></>,
  pencil: PENCIL_ICON,
  zap: <path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12l1-8Z"/>,
  'alert-triangle': ALERT_ICON,
  school: <><path d="M3 9.5 12 4l9 5.5-9 5.5-9-5.5Z"/><path d="M7 12v4.5c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5V12"/><path d="M21 10v6"/></>,
  square: <><rect x="6" y="6" width="12" height="12" rx="1.5"/></>,
};

export function Icon({ name, size, className = '' }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={`icon ${className}`}
      width={size} height={size} aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

// Wordmark produk: monogram sederhana + teks.
export function Logo({ size = 26 }: { size?: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, fontWeight: 700, letterSpacing: '-0.02em' }}>
      <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true">
        <rect width="26" height="26" rx="7" fill="var(--brand-600)" />
        <path d="M7 13.8l3.4 3.4L19 8.6" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
      FlowCBT
    </span>
  );
}
