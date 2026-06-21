export type Path = 'A' | 'B' | 'C' | 'D';

/** Bot decision-making archetypes. Assigned once at game start, persists across rounds. */
export type Personality = 'risky' | 'safe' | 'random' | 'sticky' | 'flighty';

export type Thug = {
  id: number;
  name: string;
  avatar: string;
  alive: boolean;
  chosenPath?: Path;
  isPlayer: boolean;
  /** Bot personality. Undefined for the player. */
  personality?: Personality;
  /** Round in which this thug was eliminated (undefined if still alive). */
  eliminatedRound?: number;
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
  pool: number;
  thugs: Thug[];
  rounds: number;
  copPath?: Path;
  won: boolean;
  /** What the player actually received this game (0 if lost, share of pool if won). */
  payout: number;
  /** Number of winners that split the pool. */
  winners: number;
  timestamp: number;
};

export type GamePhase =
  | 'idle'
  | 'character-pick'
  | 'start-countdown'
  | 'choosing'
  | 'revealing-bots'
  | 'cop-checking'
  | 'round-result'
  | 'final-result';
