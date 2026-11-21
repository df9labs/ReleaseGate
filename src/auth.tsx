import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type Account, type User } from './api';

type AuthState = {
  user: User | null;
  account: Account | null;
  loading: boolean;
  failure: string;
  refresh: () => Promise<void>;
  accept: (user: User) => void;
  logout: (redirect?: boolean) => Promise<void>;
};
const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const cache = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState('');
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
      if (response.status === 401) {
        setUser(null);
        setAccount(null);
      } else if (response.ok) {
        const session = await response.json();
        setUser(session.user ?? null);
        setAccount(session.account ?? null);
      }
      else throw new Error('The release control server could not load your session.');
      setFailure('');
    } catch {
      setFailure('The release control server could not load your session.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  async function logout() {
    await api.logout();
    cache.clear();
    setUser(null);
    window.location.replace('/login');
  }
  return (
    <AuthContext.Provider
      value={{
        user, account, loading, failure, refresh, logout,
        accept: (next) => {
          setUser(next);
          void refresh();
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  const state = useContext(AuthContext);
  if (!state) throw new Error('The application requires an authentication provider.');
  return state;
}
