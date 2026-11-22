// icons.tsx — set ikon SVG stroke (gaya Lucide) TANPA dependensi eksternal.
// Dipakai seluruh app agar TIDAK ADA emoji dekoratif di UI (enterprise look).
import type { ReactNode, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function I({ size = 18, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

// ---- brand ----
export const LogoMark = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <rect x="1" y="1" width="30" height="30" rx="7" fill="#2563EB" />
    <path d="M9 23V9h11" stroke="#FFFFFF" strokeWidth="3.2" strokeLinecap="round" fill="none" />
    <path d="M9 16h8" stroke="#FFFFFF" strokeWidth="3.2" strokeLinecap="round" />
    <circle cx="23.5" cy="20" r="2.2" fill="#93C5FD" />
  </svg>
)

// ---- navigasi ----
export const IconDashboard = (p: IconProps) => (
  <I {...p}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></I>
)
export const IconStudents = (p: IconProps) => (
  <I {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></I>
)
export const IconClass = (p: IconProps) => (
  <I {...p}><path d="M2 3h20" /><path d="M4 3v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V3" /><path d="M9 19v2" /><path d="M15 19v2" /><path d="M9 10h.01" /><path d="M12 10h.01" /><path d="M15 10h.01" /></I>
)
export const IconExam = (p: IconProps) => (
  <I {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 13l2 2 4-4" /></I>
)
export const IconChart = (p: IconProps) => (
  <I {...p}><path d="M3 3v18h18" /><path d="M7 15l3.5-4 3 3L21 7" /></I>
)
export const IconHistory = (p: IconProps) => (
  <I {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></I>
)
export const IconChart2 = (p: IconProps) => (
  <I {...p}><path d="M18 20V10" /><path d="M12 20V4" /><path d="M6 20v-6" /></I>
)
export const IconCredit = (p: IconProps) => (
  <I {...p}><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></I>
)
export const IconSettings = (p: IconProps) => (
  <I {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></I>
)
export const IconLogout = (p: IconProps) => (
  <I {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></I>
)
export const IconDots = (p: IconProps) => (
  <I {...p}><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></I>
)

// ---- aksi ----
export const IconPlus = (p: IconProps) => (<I {...p}><path d="M12 5v14" /><path d="M5 12h14" /></I>)
export const IconSearch = (p: IconProps) => (<I {...p}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></I>)
export const IconUpload = (p: IconProps) => (<I {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m17 8-5-5-5 5" /><path d="M12 3v12" /></I>)
export const IconDownload = (p: IconProps) => (<I {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></I>)
export const IconTrash = (p: IconProps) => (<I {...p}><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></I>)
export const IconEdit = (p: IconProps) => (<I {...p}><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></I>)
export const IconCopy = (p: IconProps) => (<I {...p}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></I>)
export const IconEraser = (p: IconProps) => (<I {...p}><path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l9-9a1 1 0 0 1 1.4 0l6.3 6.3a1 1 0 0 1 0 1.4L13 21H7Z" /><path d="M22 21H7" /><path d="m5 11 8 8" /></I>)
export const IconPrint = (p: IconProps) => (<I {...p}><path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" rx="1" /></I>)
export const IconPhone = (p: IconProps) => (<I {...p}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" /></I>)
export const IconRefresh = (p: IconProps) => (<I {...p}><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></I>)
export const IconPlay = (p: IconProps) => (<I {...p}><polygon points="6 3 20 12 6 21 6 3" /></I>)
export const IconFlag = (p: IconProps) => (<I {...p}><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><path d="M4 22v-7" /></I>)
export const IconCheck = (p: IconProps) => (<I {...p}><path d="M20 6 9 17l-5-5" /></I>)
export const IconX = (p: IconProps) => (<I {...p}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></I>)
export const IconLeft = (p: IconProps) => (<I {...p}><path d="m15 18-6-6 6-6" /></I>)
export const IconRight = (p: IconProps) => (<I {...p}><path d="m9 18 6-6-6-6" /></I>)
export const IconChevronDown = (p: IconProps) => (<I {...p}><path d="m6 9 6 6 6-6" /></I>)
export const IconMenu = (p: IconProps) => (<I {...p}><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></I>)
export const IconGrid = (p: IconProps) => (<I {...p}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></I>)
export const IconSwap = (p: IconProps) => (<I {...p}><path d="M8 3 4 7l4 4" /><path d="M4 7h16" /><path d="m16 21 4-4-4-4" /><path d="M20 17H4" /></I>)

// ---- status & info ----
export const IconWarn = (p: IconProps) => (<I {...p}><path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></I>)
export const IconAlertCircle = (p: IconProps) => (<I {...p}><circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" /></I>)
export const IconInfo = (p: IconProps) => (<I {...p}><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></I>)
export const IconShield = (p: IconProps) => (<I {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" /></I>)
export const IconClock = (p: IconProps) => (<I {...p}><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></I>)
export const IconWifi = (p: IconProps) => (<I {...p}><path d="M5 12.55a11 11 0 0 1 14.08 0" /><path d="M1.42 9a16 16 0 0 1 21.16 0" /><path d="M8.53 16.11a6 6 0 0 1 6.95 0" /><path d="M12 20h.01" /></I>)
export const IconWifiOff = (p: IconProps) => (<I {...p}><path d="m2 2 20 20" /><path d="M8.53 16.11a6 6 0 0 1 6.95 0" /><path d="M5 12.55a11 11 0 0 1 5.17-2.39" /><path d="M10.71 5.05A16 16 0 0 1 22.58 9" /><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" /><path d="M12 20h.01" /></I>)
export const IconTrendUp = (p: IconProps) => (<I {...p}><path d="m22 7-8.5 8.5-5-5L2 17" /><path d="M16 7h6v6" /></I>)
export const IconTrendDown = (p: IconProps) => (<I {...p}><path d="m22 17-8.5-8.5-5 5L2 7" /><path d="M16 17h6v-6" /></I>)
export const IconTrophy = (p: IconProps) => (<I {...p}><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></I>)
export const IconEye = (p: IconProps) => (<I {...p}><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></I>)
export const IconEyeOff = (p: IconProps) => (<I {...p}><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" /><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" /><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" /><line x1="2" x2="22" y1="2" y2="22" /></I>)
export const IconSun = (p: IconProps) => (<I {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" /></I>)
export const IconMoon = (p: IconProps) => (<I {...p}><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></I>)
export const IconCalendar = (p: IconProps) => (<I {...p}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /></I>)
export const IconKey = (p: IconProps) => (<I {...p}><circle cx="7.5" cy="15.5" r="5.5" /><path d="m21 2-9.6 9.6" /><path d="m15.5 7.5 3 3L22 7l-3-3" /></I>)
export const IconBank = (p: IconProps) => (<I {...p}><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" /><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" /><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" /><path d="M10 6h4" /><path d="M10 10h4" /><path d="M10 14h4" /><path d="M10 18h4" /></I>)
export const IconEmpty = (p: IconProps) => (<I {...p}><path d="M13.73 21a2 2 0 0 1-3.46 0" /><path d="M18.63 13A17.89 17.89 0 0 1 18 8" /><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" /><path d="M18 8a6 6 0 0 0-9.33-5" /></I>)

// ---- tambahan v3 (portal ujian) ----
export const IconBook = (p: IconProps) => (<I {...p}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" /></I>)
export const IconExpand = (p: IconProps) => (<I {...p}><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" /><path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" /></I>)
export const IconShrink = (p: IconProps) => (<I {...p}><path d="M8 3v3a2 2 0 0 1-2 2H3" /><path d="M21 8h-3a2 2 0 0 1-2-2V3" /><path d="M3 16h3a2 2 0 0 1 2 2v3" /><path d="M16 21v-3a2 2 0 0 1 2-2h3" /></I>)
export const IconUser = (p: IconProps) => (<I {...p}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></I>)
export const IconChevronUp = (p: IconProps) => (<I {...p}><path d="m18 15-6-6-6 6" /></I>)
export const IconClipboard = (p: IconProps) => (<I {...p}><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="M9 12h6" /><path d="M9 16h4" /></I>)
