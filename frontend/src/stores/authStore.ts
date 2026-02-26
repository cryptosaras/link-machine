import { create } from "zustand";
import api from "@/api/client";

interface User {
  id: string;
  username: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: !!localStorage.getItem("access_token"),
  isLoading: true,

  login: async (username: string, password: string) => {
    const res = await api.post("/auth/login", { username, password });
    localStorage.setItem("access_token", res.data.access_token);
    const me = await api.get("/auth/me");
    set({ user: me.data, isAuthenticated: true });
  },

  logout: () => {
    localStorage.removeItem("access_token");
    set({ user: null, isAuthenticated: false });
  },

  checkAuth: async () => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      set({ isLoading: false, isAuthenticated: false });
      return;
    }
    try {
      const me = await api.get("/auth/me");
      set({ user: me.data, isAuthenticated: true, isLoading: false });
    } catch {
      localStorage.removeItem("access_token");
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },
}));
