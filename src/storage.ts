import type { User, GameRound } from './types';

const USER_KEY = 'cp_user';
const HISTORY_KEY = 'cp_history';
const ACCOUNTS_KEY = 'cp_accounts';

/** Persisted account record. Password is stored as a SHA-256 hex hash with a
 *  per-account random salt. NOT a substitute for a real backend — but enough
 *  that someone snooping localStorage can't read your plaintext password. */
export type Account = {
  id: string;
  name: string;
  email: string;       // canonical lowercase
  passwordHash: string;
  salt: string;
  balance: number;     // last-known balance, restored on sign-in
  createdAt: number;
};

export const storage = {
  getUser(): User | null {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  },
  setUser(user: User | null) {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  },
  getHistory(): GameRound[] {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  },
  pushHistory(round: GameRound) {
    const history = this.getHistory();
    history.unshift(round);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 50)));
  },
  clearHistory() {
    localStorage.removeItem(HISTORY_KEY);
  },

  // --- Account directory ---
  getAccounts(): Record<string, Account> {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    return raw ? JSON.parse(raw) : {};
  },
  getAccount(email: string): Account | null {
    return this.getAccounts()[email.toLowerCase()] ?? null;
  },
  saveAccount(account: Account) {
    const all = this.getAccounts();
    all[account.email.toLowerCase()] = account;
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(all));
  },
  updateAccountBalance(email: string, balance: number) {
    const acc = this.getAccount(email);
    if (!acc) return;
    acc.balance = balance;
    this.saveAccount(acc);
  },
};

// --- Password hashing helpers (WebCrypto SHA-256) ---
const enc = new TextEncoder();
const toHex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

export async function hashPassword(password: string, salt: string): Promise<string> {
  const data = enc.encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toHex(digest);
}

export function generateSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}
