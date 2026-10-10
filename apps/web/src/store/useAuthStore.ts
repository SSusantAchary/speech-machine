import { create } from "zustand";
import { authApi, setToken, clearToken, ensureAccessToken } from "@/lib/api";

type AuthState = {
  userEmail: string | null;
  loading: boolean;
  bootstrapped: boolean;
  bootstrap: () => Promise<boolean>;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  setup: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set) => ({
  userEmail: null,
  loading: false,
  bootstrapped: false,
  bootstrap: async () => {
    const token = await ensureAccessToken();
    if (!token) {
      set({ userEmail: null, bootstrapped: true });
      return false;
    }
    try {
      const user = await authApi.me();
      set({ userEmail: user.email, bootstrapped: true });
      return true;
    } catch {
      clearToken();
      set({ userEmail: null, bootstrapped: true });
      return false;
    }
  },
  login: async (email, password) => {
    set({ loading: true });
    try {
      const token = await authApi.login(email, password);
      setToken(token.access_token);
      set({ userEmail: email, loading: false });
    } catch (error) {
      set({ loading: false });
      throw error;
    }
  },
  signup: async (email, password) => {
    set({ loading: true });
    try {
      const token = await authApi.signup(email, password);
      setToken(token.access_token);
      set({ userEmail: email, loading: false });
    } catch (error) {
      set({ loading: false });
      throw error;
    }
  },
  setup: async (email, password) => {
    set({ loading: true });
    try {
      const token = await authApi.setup(email, password);
      setToken(token.access_token);
      set({ userEmail: token.user?.email || email, loading: false, bootstrapped: true });
    } catch (error) {
      set({ loading: false });
      throw error;
    }
  },
  logout: async () => {
    await authApi.logout().catch(() => {});
    clearToken();
    set({ userEmail: null, bootstrapped: true });
  },
}));
