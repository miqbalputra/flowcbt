import { create } from 'zustand'

export type Session =
  | { kind: 'staff'; userId: string; role: 'owner' | 'teacher' | 'superadmin'; tenantId: string; name: string }
  | { kind: 'student'; sid: string; tenantId: string; name: string }
  | null

interface AuthState {
  session: Session
  setSession: (s: Session) => void
  logout: () => void
}

export const useAuth = create<AuthState>(set => ({
  session: null,
  setSession: session => set({ session }),
  logout: () => set({ session: null }),
}))
