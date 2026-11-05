import { create } from 'zustand';

import { api, onSessionExpired } from '@/lib/api';
import { getApiErrorStatus } from '@/lib/api-error';
import {
  publishAuthSessionChange,
  subscribeAuthSessionChanges,
} from '@/stores/auth-session-sync';
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
  /** Volatile one-time code, cleared only by acknowledgement or session exit. */
  pendingRecoveryCode: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  sessionRevision: number;
  setUser: (user: AuthUser | null) => void;
  fetchMe: () => Promise<AuthUser | null>;
  login: (email: string, password: string) => Promise<AuthUser>;
  register: (
    name: string,
    email: string,
    password: string,
  ) => Promise<RegisterResult>;
  recoverWithCode: (
    email: string,
    recoveryCode: string,
    newPassword: string,
  ) => Promise<string>;
  acknowledgeRecoveryCode: () => void;
  updateProfile: (input: UpdateProfileInput) => Promise<AuthUser>;
  generateRecoveryCode: (currentPassword: string) => Promise<string>;
  logout: () => Promise<void>;
  externalSessionChanged: () => void;
};

// An earlier /auth/me response must never restore a previous user's session
// after login, registration or logout has changed the cookie.
let meRequestVersion = 0;

// A failed /auth/logout can leave the HttpOnly cookie active. Keep a
// per-browser local logout fence until explicit authentication succeeds.
// This stores no user data, tokens, cookies or recovery secrets.
const LOCAL_LOGOUT_KEY = 'demanage:local-logout-pending';
let logoutPendingInMemory = false;

function localLogoutPending() {
  if (logoutPendingInMemory) return true;
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(LOCAL_LOGOUT_KEY) === '1';
  } catch {
    return false;
  }
}

function setLocalLogoutPending(pending: boolean) {
  logoutPendingInMemory = pending;
  if (typeof window === 'undefined') return;
  try {
    if (pending) window.localStorage.setItem(LOCAL_LOGOUT_KEY, '1');
    else window.localStorage.removeItem(LOCAL_LOGOUT_KEY);
  } catch {
    // Storage disabled: the in-memory fence still protects this tab.
  }
}

export const useAuthStore = create<AuthState>((set, get) => {
  function setSessionUser(
    user: AuthUser | null,
    forceNewSession = false,
    newRecoveryCode?: string,
  ) {
    const sessionChanged = forceNewSession || get().user?.id !== user?.id;

    set((state) => ({
      user,
      pendingRecoveryCode: newRecoveryCode ?? (sessionChanged ? null : state.pendingRecoveryCode),
      isAuthenticated: Boolean(user),
      isLoading: false,
      sessionRevision: state.sessionRevision + (sessionChanged ? 1 : 0),
    }));
  }

  return {
    user: null,
    pendingRecoveryCode: null,
    isAuthenticated: false,
    isLoading: true,
    sessionRevision: 0,

    setUser: (user) => {
      if (user) setLocalLogoutPending(false);
      const previousUser = get().user;
      ++meRequestVersion;
      setSessionUser(user);
      if (previousUser && !user) publishAuthSessionChange();
    },

    fetchMe: async () => {
      const requestVersion = ++meRequestVersion;
      if (localLogoutPending()) {
        setSessionUser(null);
        return null;
      }
      try {
        const { data } = await api.get<{ user: AuthUser }>('/auth/me');
        if (requestVersion !== meRequestVersion) return get().user;
        setSessionUser(data.user);
        return data.user;
      } catch (error) {
        if (requestVersion !== meRequestVersion) return get().user;
        // Only an explicit 401 ends the session; a network blip or a 5xx
        // must not log the user out.
        if (getApiErrorStatus(error) === 401 || !get().user) {
          setSessionUser(null);
          return null;
        }
        set({ isLoading: false });
        return get().user;
      }
    },

    login: async (email, password) => {
      ++meRequestVersion;
      const { data } = await api.post<{ user: AuthUser }>('/auth/login', {
        email,
        password,
      });
      ++meRequestVersion;
      setLocalLogoutPending(false);
      setSessionUser(data.user, true);
      publishAuthSessionChange();
      return data.user;
    },

    register: async (name, email, password) => {
      ++meRequestVersion;
      const { data } = await api.post<RegisterResult>('/auth/register', {
        name,
        email,
        password,
      });
      ++meRequestVersion;
      setLocalLogoutPending(false);
      setSessionUser(data.user, true, data.recoveryCode);
      publishAuthSessionChange();
      return data;
    },
    recoverWithCode: async (email, recoveryCode, newPassword) => {
      ++meRequestVersion;
      const { data } = await api.post<RegisterResult>(
        '/auth/recover-password',
        { email, recoveryCode, newPassword },
      );
      ++meRequestVersion;
      setLocalLogoutPending(false);
      setSessionUser(data.user, true);
      publishAuthSessionChange();
      return data.recoveryCode;
    },
    acknowledgeRecoveryCode: () => {
      set({ pendingRecoveryCode: null });
    },

    updateProfile: async (input) => {
      const revision = get().sessionRevision;
      const { data } = await api.patch<{ user: AuthUser }>('/auth/me', {
        name: input.name,
        salary: input.salary,
        salaryReceiveDay: input.salaryReceiveDay,
        notes: input.notes,
      });
      if (revision === get().sessionRevision) {
        setSessionUser(data.user);
      }
      return data.user;
    },

    generateRecoveryCode: async (currentPassword) => {
      const revision = get().sessionRevision;
      const { data } = await api.post<{ recoveryCode: string }>(
        '/auth/recovery-code',
        { currentPassword },
      );
      if (revision === get().sessionRevision) {
        set((state) => ({
          user: state.user ? { ...state.user, hasRecoveryCode: true } : null,
        }));
      }
      return data.recoveryCode;
    },

    logout: async () => {
      ++meRequestVersion;
      // Remove financial UI / cache before any network request. Do not
      // advertise remote revocation if the server could not be contacted.
      setLocalLogoutPending(true);
      setSessionUser(null, true);
      publishAuthSessionChange();
      await api.post('/auth/logout');
    },
    externalSessionChanged: () => {
      // Drop the previous account immediately; only /auth/me can establish
      // which account currently owns the shared cookie.
      ++meRequestVersion;
      setSessionUser(null, true);
      void get().fetchMe();
    },
  };
});

/** Register once at application entry; returns cleanup for deterministic tests. */
export function startAuthSessionSync() {
  return subscribeAuthSessionChanges(() => {
    useAuthStore.getState().externalSessionChanged();
  });
}

onSessionExpired(
  () => {
    const { user, setUser } = useAuthStore.getState();
    if (user) setUser(null);
  },
  () => useAuthStore.getState().sessionRevision,
);
