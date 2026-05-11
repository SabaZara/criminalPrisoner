export type Path = 'A' | 'B' | 'C';

export type Thug = {
  id: number;
  name: string;
  avatar: string;
  alive: boolean;
  chosenPath?: Path;
  isPlayer: boolean;
};

export type User = {
  id: string;
  name: string;
  email?: string;
  avatar?: string;
  balance: number;
  provider: 'guest' | 'google' | 'email';
  createdAt: number;
};

export type GameRound = {
  id: string;
  bet: number;
  thugs: Thug[];
  copPath?: Path;
  won: boolean;
  payout: number;
  timestamp: number;
};

export type GamePhase =
  | 'idle'
  | 'choosing'
  | 'revealing-bots'
  | 'cop-checking'
  | 'result';
