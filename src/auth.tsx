import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User } from './types';
import { storage } from './storage';

type AuthCtx = {
  user: User | null;
  loginGuest: () => void;
  loginGoogle: () => void;
  loginEmail: (email: string, name: string) => void;
  logout: () => void;
  updateBalance: (delta: number) => void;
  setBalance: (amount: number) => void;
};

const AuthContext = createContext<AuthCtx | null>(null);

const randomId = () => Math.random().toString(36).slice(2, 10);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => storage.getUser());

  useEffect(() => {
    storage.setUser(user);
  }, [user]);

  const loginGuest = () => {
    const guestNum = Math.floor(Math.random() * 9000 + 1000);
    setUser({
      id: 'guest_' + randomId(),
      name: `Guest${guestNum}`,
      balance: 10000,
      provider: 'guest',
      createdAt: Date.now(),
    });
  };

  const loginGoogle = () => {
    const mockNames = ['Alex Carter', 'Jordan Lee', 'Sam Rivera', 'Morgan Hayes', 'Taylor Quinn'];
    const name = mockNames[Math.floor(Math.random() * mockNames.length)];
    const email = name.toLowerCase().replace(' ', '.') + '@gmail.com';
    setUser({
      id: 'google_' + randomId(),
      name,
      email,
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=d4af37&color=000`,
      balance: 50000,
      provider: 'google',
      createdAt: Date.now(),
    });
  };

  const loginEmail = (email: string, name: string) => {
    setUser({
      id: 'email_' + randomId(),
      name,
      email,
      balance: 10000,
      provider: 'email',
      createdAt: Date.now(),
    });
  };

  const logout = () => setUser(null);

  const updateBalance = (delta: number) => {
    setUser((u) => (u ? { ...u, balance: Math.max(0, u.balance + delta) } : u));
  };

  const setBalance = (amount: number) => {
    setUser((u) => (u ? { ...u, balance: Math.max(0, amount) } : u));
  };

  return (
    <AuthContext.Provider
      value={{ user, loginGuest, loginGoogle, loginEmail, logout, updateBalance, setBalance }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
