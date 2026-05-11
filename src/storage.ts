import type { User, GameRound } from './types';

const USER_KEY = 'cp_user';
const HISTORY_KEY = 'cp_history';

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
};
