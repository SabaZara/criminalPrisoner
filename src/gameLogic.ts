import { SPRITES } from './assets/sprites';
import type { Path, Personality, Thug } from './types';

/** Roster slot → (name, personality). The player picks one slot to play AS; the rest are bots. */
type Slot = { name: string; personality: Personality };
const ROSTER: Slot[] = [
  { name: 'Viper',  personality: 'risky' },
  { name: 'Shadow', personality: 'safe' },
  { name: 'Lucky',  personality: 'random' },
  { name: 'Blaze',  personality: 'risky' },
  { name: 'Rocco',  personality: 'sticky' },
  { name: 'Ghost',  personality: 'safe' },
  { name: 'Tank',   personality: 'sticky' },
  { name: 'Joker',  personality: 'flighty' },
  { name: 'Bandit', personality: 'safe' },
  { name: 'Ace',    personality: 'flighty' },
];

export const PATHS: Path[] = ['A', 'B', 'C', 'D'];
export const TOTAL_THUGS = 10;

/** The slot at `playerSlot` becomes the player (uses playerName, no personality);
 *  the other 9 slots keep their roster name + personality and act as bots. */
export function buildInitialThugs(playerName: string, playerSlot: number = 0): Thug[] {
  return ROSTER.map((slot, i) => {
    const isPlayer = i === playerSlot;
    return {
      id: i + 1,
      name: isPlayer ? playerName : slot.name,
      avatar: SPRITES.thugs[i],
      alive: true,
      isPlayer,
      personality: isPlayer ? undefined : slot.personality,
    };
  });
}

/** Names/personalities available for the character-pick screen (no player name needed yet). */
export function getRoster(): readonly Slot[] {
  return ROSTER;
}

export function pickRandomPath(): Path {
  return PATHS[Math.floor(Math.random() * PATHS.length)];
}

/** Count how many ALIVE thugs are currently committed to each path. */
export function countByPath(thugs: Thug[]): Record<Path, number> {
  const counts: Record<Path, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const t of thugs) {
    if (t.alive && t.chosenPath) counts[t.chosenPath] += 1;
  }
  return counts;
}

/** Pick the path with the fewest alive thugs on it (ties broken randomly). */
function pickLeastCrowded(thugs: Thug[]): Path {
  const counts = countByPath(thugs);
  const min = Math.min(...PATHS.map((p) => counts[p]));
  const cands = PATHS.filter((p) => counts[p] === min);
  return cands[Math.floor(Math.random() * cands.length)];
}

/** Pick the path with the most alive thugs (ties broken randomly).
 *  Falls back to random if all paths are empty. */
function pickMostCrowded(thugs: Thug[]): Path {
  const counts = countByPath(thugs);
  const max = Math.max(...PATHS.map((p) => counts[p]));
  if (max === 0) return pickRandomPath();
  const cands = PATHS.filter((p) => counts[p] === max);
  return cands[Math.floor(Math.random() * cands.length)];
}

/**
 * Decide a bot's initial pick for the round based on its personality and the
 * current crowd distribution. `thugs` should already include earlier-picked
 * bots so later bots can react to them.
 */
export function decideBotPick(thug: Thug, thugs: Thug[]): Path {
  switch (thug.personality) {
    case 'risky':
      // Risk-takers go against the crowd — pick the least-populated path.
      return pickLeastCrowded(thugs);
    case 'safe':
      // Safe players hide in numbers — pick the most-populated path.
      return pickMostCrowded(thugs);
    case 'sticky':
    case 'flighty':
    case 'random':
    default:
      return pickRandomPath();
  }
}

/** Per-personality probability that this bot will SWITCH its pick once during
 *  the pick window. Lower = more decisive. Tuned to feel varied without chaos. */
const SWITCH_RATE: Record<Personality, number> = {
  sticky: 0.04, // almost never changes mind
  safe: 0.10,   // mild reconsideration
  random: 0.12, // baseline
  risky: 0.18,  // bolder, might re-evaluate the crowd
  flighty: 0.32, // indecisive, frequent switches
};

export function switchProbability(thug: Thug): number {
  if (!thug.personality) return 0;
  return SWITCH_RATE[thug.personality];
}

/** Decide what a bot SWITCHES to (must be different from its current pick).
 *  Same personality logic applied to the alternatives. */
export function decideBotSwitch(thug: Thug, thugs: Thug[]): Path {
  const current = thug.chosenPath;
  const others = PATHS.filter((p) => p !== current);
  if (thug.personality === 'risky') {
    // Re-evaluate against the crowd, but exclude the current path.
    const counts = countByPath(thugs);
    const min = Math.min(...others.map((p) => counts[p]));
    const cands = others.filter((p) => counts[p] === min);
    return cands[Math.floor(Math.random() * cands.length)];
  }
  if (thug.personality === 'safe') {
    const counts = countByPath(thugs);
    const max = Math.max(...others.map((p) => counts[p]));
    const cands = others.filter((p) => counts[p] === max);
    return cands[Math.floor(Math.random() * cands.length)];
  }
  return others[Math.floor(Math.random() * others.length)];
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
