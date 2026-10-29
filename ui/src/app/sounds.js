// Small sounds, made on the spot with WebAudio (no files): a soft two-note call when an agent
// waits on you, a tick when one finishes, a click when you send, a blip when you answer.
import { get } from '../store.js';

let ctx;
const audio = () => (ctx ||= new AudioContext());

/** One soft sine note with a quick attack and a gentle tail. */
function note(at, freq, len, gain, type = 'sine') {
  const a = audio();
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  o.connect(g).connect(a.destination);
  o.start(at);
  o.stop(at + len + 0.02);
}

const SOUNDS = {
  // Waiting on you: two rising notes, a fifth apart.
  arrive: (t, v) => {
    note(t, 659.25, 0.22, 0.16 * v);
    note(t + 0.11, 987.77, 0.34, 0.13 * v);
  },
  // Done / up for review: one bright tick.
  done: (t, v) => note(t, 1318.5, 0.16, 0.09 * v, 'triangle'),
  // Sent: a quiet, low click.
  sent: (t, v) => note(t, 420, 0.07, 0.07 * v, 'triangle'),
  // Answered: a short upward blip.
  answered: (t, v) => {
    note(t, 784, 0.08, 0.08 * v);
    note(t + 0.05, 1046.5, 0.1, 0.07 * v);
  },
};

export function sound(name, { force = false } = {}) {
  const s = get().settings;
  if ((!s.sounds && !force) || window.desk?.isPanel) return;
  try {
    const a = audio();
    if (a.state === 'suspended') a.resume();
    SOUNDS[name]?.(a.currentTime + 0.01, Math.max(0, Math.min(1, s.volume ?? 0.55)));
  } catch {}
}
