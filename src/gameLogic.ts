import type { Path, Thug } from './types';

const BOT_NAMES = ['Viper', 'Shadow', 'Lucky', 'Blaze', 'Rocco', 'Ghost', 'Tank', 'Joker', 'Bandit', 'Ace'];
const AVATARS = ['🥷', '🧔', '🤠', '👨‍🦲', '🧑‍🎤', '👻', '💪', '🤡', '🦹', '😎'];

export const PATHS: Path[] = ['A', 'B', 'C'];

export function buildInitialThugs(playerName: string): Thug[] {
  return Array.from({ length: 10 }, (_, i) => ({
    id: i + 1,
    name: i === 0 ? playerName : BOT_NAMES[i],
    avatar: AVATARS[i],
    alive: true,
    isPlayer: i === 0,
  }));
}

export function pickRandomPath(): Path {
  return PATHS[Math.floor(Math.random() * 3)];
}

export function pickBotPaths(thugs: Thug[]): Thug[] {
  return thugs.map((t) =>
    t.isPlayer ? t : { ...t, chosenPath: pickRandomPath() }
  );
}

export function applyCopCheck(thugs: Thug[], copPath: Path): Thug[] {
  return thugs.map((t) => ({
    ...t,
    alive: t.chosenPath !== copPath,
  }));
}

export const PAYOUT_MULTIPLIER = 10;
