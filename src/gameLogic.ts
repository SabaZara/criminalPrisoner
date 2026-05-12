import { SPRITES } from './assets/sprites';
import type { Path, Thug } from './types';

const BOT_NAMES = ['Viper', 'Shadow', 'Lucky', 'Blaze', 'Rocco', 'Ghost', 'Tank', 'Joker', 'Bandit', 'Ace'];

export const PATHS: Path[] = ['A', 'B', 'C', 'D'];
export const TOTAL_THUGS = 10;

export function buildInitialThugs(playerName: string): Thug[] {
  return Array.from({ length: TOTAL_THUGS }, (_, i) => ({
    id: i + 1,
    name: i === 0 ? playerName : BOT_NAMES[i],
    avatar: SPRITES.thugs[i],
    alive: true,
    isPlayer: i === 0,
  }));
}

export function pickRandomPath(): Path {
  return PATHS[Math.floor(Math.random() * PATHS.length)];
}

/** Fill in a random path for any alive bot that doesn't already have one (safety net).
 *  Does NOT overwrite existing picks — bot indecision logic owns those. */
export function pickBotPaths(thugs: Thug[]): Thug[] {
  return thugs.map((t) =>
    t.isPlayer || !t.alive || t.chosenPath ? t : { ...t, chosenPath: pickRandomPath() }
  );
}

/** Mark thugs on the cop's path as eliminated this round. Survivors keep alive=true. */
export function applyCopCheck(thugs: Thug[], copPath: Path, round: number): Thug[] {
  return thugs.map((t) => {
    if (!t.alive) return t;
    if (t.chosenPath === copPath) {
      return { ...t, alive: false, eliminatedRound: round };
    }
    return t;
  });
}

/** Clear chosenPath for all alive thugs (start of next round). */
export function clearChoices(thugs: Thug[]): Thug[] {
  return thugs.map((t) => (t.alive ? { ...t, chosenPath: undefined } : t));
}

/**
 * Decide outcome after a cop check:
 * - If 1+ alive thugs remain → continue to next round (no winner yet)
 * - If 0 alive AND multiple were eliminated this round → those last-eliminated split the pool
 * - If 0 alive AND only 1 was eliminated this round (impossible if prior round had 1) — fallback
 *
 * Returns the set of winners (those who split the pool) or null if rounds continue.
 */
export function determineWinners(thugs: Thug[], lastEliminatedRound: number): Thug[] | null {
  const alive = thugs.filter((t) => t.alive);
  if (alive.length > 1) return null;
  if (alive.length === 1) return alive;
  // 0 alive — split between those eliminated in the final round
  return thugs.filter((t) => t.eliminatedRound === lastEliminatedRound);
}

/** Player ante is `bet`; total pool is bet * 10 (other 9 thugs ante same amount). */
export function calculatePool(bet: number): number {
  return bet * TOTAL_THUGS;
}
