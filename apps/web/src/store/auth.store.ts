import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AuthUser {
  id: string;
  username: string;
  role: 'OWNER' | 'STAFF';
  shopId: string | null;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  setTokens: (access: string, refresh: string, user: AuthUser) => void;
  logout: () => void;
  isOwner: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      setTokens: (accessToken, refreshToken, user) => {
        localStorage.setItem('access_token', accessToken);
        localStorage.setItem('refresh_token', refreshToken);
        set({ accessToken, refreshToken, user });
      },
      logout: () => {
        localStorage.clear();
        set({ user: null, accessToken: null, refreshToken: null });
      },
      isOwner: () => get().user?.role === 'OWNER',
    }),
    { name: 'auth-store', partialize: (s) => ({ user: s.user }) },
  ),
);
