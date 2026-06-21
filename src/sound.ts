/** Elementary sound system using WebAudio API oscillators — no audio files.
 *  Tiny synthesized clicks/blips/chords sized for casual game feedback. */

let ctx: AudioContext | null = null;
let muted = false;

const MUTE_KEY = 'cp_muted';

if (typeof window !== 'undefined') {
  muted = localStorage.getItem(MUTE_KEY) === '1';
}

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  // Browsers suspend AudioContext until a user gesture — resume on demand.
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/** A single oscillator tone with envelope. */
function tone(freq: number, durationMs: number, opts: {
  type?: OscillatorType;
  attack?: number;
  release?: number;
  gain?: number;
  startAt?: number;
  pitchEnd?: number;
} = {}) {
  const c = getCtx();
  if (!c || muted) return;
  const t0 = c.currentTime + (opts.startAt ?? 0);
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  if (opts.pitchEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.pitchEnd), t0 + durationMs / 1000);
  }
  const peak = opts.gain ?? 0.18;
  const attack = opts.attack ?? 0.005;
  const release = opts.release ?? 0.08;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + durationMs / 1000 + release);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + durationMs / 1000 + release + 0.05);
}

/** Brief filtered noise burst (used for the busted thud). */
function noiseBurst(durationMs: number, opts: { gain?: number; startAt?: number } = {}) {
  const c = getCtx();
  if (!c || muted) return;
  const t0 = c.currentTime + (opts.startAt ?? 0);
  const length = Math.max(1, Math.floor(c.sampleRate * (durationMs / 1000)));
  const buffer = c.createBuffer(1, length, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 600;
  const g = c.createGain();
  g.gain.setValueAtTime(opts.gain ?? 0.3, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + durationMs / 1000);
  src.connect(filter);
  filter.connect(g);
  g.connect(c.destination);
  src.start(t0);
}

export const sfx = {
  /** Soft click — door tap. */
  click() {
    tone(800, 50, { type: 'triangle', gain: 0.12, release: 0.04 });
  },

  /** Door pick confirmation (slightly more substantial than click). */
  pick() {
    tone(620, 80, { type: 'sine', gain: 0.18 });
    tone(940, 80, { type: 'sine', gain: 0.12, startAt: 0.04 });
  },

  /** Countdown beep — same tone for 3, 2, 1; brighter for GO. */
  countdownTick() {
    tone(660, 120, { type: 'sine', gain: 0.2 });
  },
  countdownGo() {
    tone(880, 80, { type: 'sine', gain: 0.22 });
    tone(1320, 140, { type: 'sine', gain: 0.2, startAt: 0.05 });
  },

  /** Spotlight strike — short alert blip. */
  strike() {
    tone(440, 60, { type: 'square', gain: 0.16, release: 0.04 });
    tone(220, 220, { type: 'sine', gain: 0.18, startAt: 0.04, pitchEnd: 110 });
  },

  /** Player busted — low descending thud. */
  busted() {
    noiseBurst(200, { gain: 0.35 });
    tone(220, 350, { type: 'sawtooth', gain: 0.22, pitchEnd: 60, release: 0.2 });
  },

  /** Win — rising arpeggio. */
  win() {
    tone(523.25, 140, { type: 'triangle', gain: 0.22 });               // C5
    tone(659.25, 140, { type: 'triangle', gain: 0.22, startAt: 0.10 }); // E5
    tone(783.99, 200, { type: 'triangle', gain: 0.24, startAt: 0.20 }); // G5
    tone(1046.5, 280, { type: 'triangle', gain: 0.22, startAt: 0.32 }); // C6
  },

  /** Generic small tick — for bot path-switches if you want them audible. */
  tickQuiet() {
    tone(540, 30, { type: 'sine', gain: 0.06, release: 0.02 });
  },
};

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean) {
  muted = next;
  if (typeof window !== 'undefined') {
    localStorage.setItem(MUTE_KEY, next ? '1' : '0');
  }
}

export function toggleMuted(): boolean {
  setMuted(!muted);
  return muted;
}
