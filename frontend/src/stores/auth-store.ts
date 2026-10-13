import { create } from 'zustand';

import { api, onSessionExpired } from '@/lib/api';
import { getApiErrorCode, getApiErrorStatus } from '@/lib/api-error';
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
  sessionRevision: number;
  setUser: (user: AuthUser | null) => void;
  fetchMe: () => Promise<AuthUser | null>;
  login: (email: string, password: string) => Promise<AuthUser>;
  register: (
    name: string,
    email: string,
    password: string,
  ) => Promise<RegisterResult>;
  updateProfile: (input: UpdateProfileInput) => Promise<AuthUser>;
  generateRecoveryCode: (currentPassword: string) => Promise<string>;
  logout: () => Promise<void>;
};

// An earlier /auth/me response must never restore a previous user's session
// after login, registration or logout has changed the cookie.
let meRequestVersion = 0;

export const useAuthStore = create<AuthState>((set, get) => {
  function setSessionUser(user: AuthUser | null, forceNewSession = false) {
    const sessionChanged = forceNewSession || get().user?.id !== user?.id;

    set((state) => ({
      user,
      isAuthenticated: Boolean(user),
      isLoading: false,
      sessionRevision: state.sessionRevision + (sessionChanged ? 1 : 0),
    }));
  }

  return {
    user: null,
    isAuthenticated: false,
    isLoading: true,
    sessionRevision: 0,

    setUser: (user) => {
      ++meRequestVersion;
      setSessionUser(user);
    },

    fetchMe: async () => {
      const requestVersion = ++meRequestVersion;
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
      setSessionUser(data.user, true);
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
      setSessionUser(data.user, true);
      return data;
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
      let clearLocalSession = false;
      try {
        await api.post('/auth/logout');
        clearLocalSession = true;
      } catch (error) {
        // The cookie is cleared server-side even when revocation fails.
        clearLocalSession =
          getApiErrorCode(error) === 'LOGOUT_REVOCATION_FAILED';
        throw error;
      } finally {
        if (clearLocalSession) {
          ++meRequestVersion;
          setSessionUser(null, true);
        }
      }
    },
  };
});

onSessionExpired(() => {
  const { user, setUser } = useAuthStore.getState();
  if (user) setUser(null);
});
