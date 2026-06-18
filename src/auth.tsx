import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User } from './types';
import { storage, hashPassword, generateSalt, type Account } from './storage';

type AuthResult = { ok: true } | { ok: false; error: string };

type AuthCtx = {
  user: User | null;
  loginGuest: () => void;
  loginGoogle: () => void;
  signUp: (name: string, email: string, password: string) => Promise<AuthResult>;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  logout: () => void;
  updateBalance: (delta: number) => void;
  setBalance: (amount: number) => void;
};

const AuthContext = createContext<AuthCtx | null>(null);

const randomId = () => Math.random().toString(36).slice(2, 10);

/** When a registered email-user is signed in, mirror their current balance back
 *  to the persisted account record so it survives logout / sign-in. */
const persistBalance = (user: User) => {
  if (user.provider === 'email' && user.email) {
    storage.updateAccountBalance(user.email, user.balance);
  }
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => storage.getUser());

  useEffect(() => {
    storage.setUser(user);
    if (user) persistBalance(user);
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

  const signUp = async (name: string, email: string, password: string): Promise<AuthResult> => {
    const trimmedName = name.trim();
    const lowerEmail = email.trim().toLowerCase();
    if (!trimmedName) return { ok: false, error: 'Name is required' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lowerEmail)) return { ok: false, error: 'Invalid email' };
    if (password.length < 6) return { ok: false, error: 'Password must be at least 6 characters' };
    if (storage.getAccount(lowerEmail)) return { ok: false, error: 'An account with this email already exists' };

    const salt = generateSalt();
    const passwordHash = await hashPassword(password, salt);
    const account: Account = {
      id: 'email_' + randomId(),
      name: trimmedName,
      email: lowerEmail,
      passwordHash,
      salt,
      balance: 10000,
      createdAt: Date.now(),
    };
    storage.saveAccount(account);
    setUser({
      id: account.id,
      name: account.name,
      email: account.email,
      balance: account.balance,
      provider: 'email',
      createdAt: account.createdAt,
    });
    return { ok: true };
  };

  const signIn = async (email: string, password: string): Promise<AuthResult> => {
    const lowerEmail = email.trim().toLowerCase();
    if (!lowerEmail || !password) return { ok: false, error: 'Email and password are required' };
    const account = storage.getAccount(lowerEmail);
    if (!account) return { ok: false, error: 'No account found for that email' };
    const hash = await hashPassword(password, account.salt);
    if (hash !== account.passwordHash) return { ok: false, error: 'Wrong password' };

    setUser({
      id: account.id,
      name: account.name,
      email: account.email,
      balance: account.balance,
      provider: 'email',
      createdAt: account.createdAt,
    });
    return { ok: true };
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
      value={{ user, loginGuest, loginGoogle, signUp, signIn, logout, updateBalance, setBalance }}
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
