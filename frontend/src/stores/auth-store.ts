import { create } from 'zustand';

import { api } from '@/lib/api';
import type { AuthUser } from '@/types/auth';

type UpdateProfileInput = {
  name?: string;
  salary?: number;
  salaryReceiveDay?: number | null;
  notes?: string | null;
};

type RegisterResult = {
  user: AuthUser;
  recoveryCode: string;
};

type AuthState = {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setUser: (user: AuthUser | null) => void;
  fetchMe: () => Promise<AuthUser | null>;
  login: (email: string, password: string) => Promise<AuthUser>;
  register: (
    name: string,
    email: string,
    password: string,
  ) => Promise<RegisterResult>;
  updateProfile: (input: UpdateProfileInput) => Promise<AuthUser>;
  generateRecoveryCode: () => Promise<string>;
  logout: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  setUser: (user) =>
    set({
      user,
      isAuthenticated: Boolean(user),
      isLoading: false,
    }),

  fetchMe: async () => {
    try {
      const { data } = await api.get<{ user: AuthUser }>('/auth/me');
      set({
        user: data.user,
        isAuthenticated: true,
        isLoading: false,
      });
      return data.user;
    } catch {
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
      });
      return null;
    }
  },

  login: async (email, password) => {
    const { data } = await api.post<{ user: AuthUser }>('/auth/login', {
      email,
      password,
    });
    set({
      user: data.user,
      isAuthenticated: true,
      isLoading: false,
    });
    return data.user;
  },

  register: async (name, email, password) => {
    const { data } = await api.post<RegisterResult>('/auth/register', {
      name,
      email,
      password,
    });
    set({
      user: data.user,
      isAuthenticated: true,
      isLoading: false,
    });
    return data;
  },

  updateProfile: async (input) => {
    const { data } = await api.patch<{ user: AuthUser }>('/auth/me', {
      name: input.name,
      salary: input.salary,
      salaryReceiveDay: input.salaryReceiveDay,
      notes: input.notes,
    });
    set({
      user: data.user,
      isAuthenticated: true,
      isLoading: false,
    });
    return data.user;
  },

  generateRecoveryCode: async () => {
    const { data } = await api.post<{ recoveryCode: string }>(
      '/auth/recovery-code',
      {},
    );
    set((state) => ({
      user: state.user ? { ...state.user, hasRecoveryCode: true } : null,
    }));
    return data.recoveryCode;
  },

  logout: async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      const { useFinanceStore } = await import('@/stores/finance-store');
      useFinanceStore.getState().clearAll();
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
      });
    }
  },
}));
