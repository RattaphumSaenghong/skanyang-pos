import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AuthUser {
  id: string;
  username: string;
  role: 'OWNER' | 'SHOP_OWNER' | 'STAFF';
  shopId: string | null;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  setTokens: (access: string, refresh: string, user: AuthUser) => void;
  setSelectedShopId: (id: string) => void;
  logout: () => void;
  isOwner: () => boolean;      // true for OWNER + SHOP_OWNER (gates owner-level features)
  isSuperOwner: () => boolean; // true for OWNER only (gates shop switcher + all-shop views)
  effectiveShopId: () => string | null;
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
      // Owner picks a shop from the dropdown — update user.shopId directly
      setSelectedShopId: (id) =>
        set((s) => ({ user: s.user ? { ...s.user, shopId: id } : null })),
      logout: () => {
        localStorage.clear();
        set({ user: null, accessToken: null, refreshToken: null });
      },
      isOwner: () => get().user?.role === 'OWNER' || get().user?.role === 'SHOP_OWNER',
      isSuperOwner: () => get().user?.role === 'OWNER',
      effectiveShopId: () => get().user?.shopId ?? null,
    }),
    { name: 'auth-store', partialize: (s) => ({ user: s.user }) },
  ),
);
