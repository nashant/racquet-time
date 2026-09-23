// End-of-round alert (sound + vibration) and screen wake lock. All best-effort.
let audio: AudioContext | null = null;

/** Must be called from a user gesture (e.g. the timer's Start tap) so audio can play later. */
export function unlockAudio(): void {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    audio = null;
  }
}

export function beep(): void {
  if (!audio) unlockAudio();
  if (!audio) return;
  const t0 = audio.currentTime;
  for (let i = 0; i < 3; i++) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'square';
    osc.frequency.value = i === 2 ? 1320 : 880;
    gain.gain.setValueAtTime(0.0001, t0 + i * 0.35);
    gain.gain.exponentialRampToValueAtTime(0.5, t0 + i * 0.35 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.35 + (i === 2 ? 0.6 : 0.25));
    osc.connect(gain).connect(audio.destination);
    osc.start(t0 + i * 0.35);
    osc.stop(t0 + i * 0.35 + 0.7);
  }
}

export function vibrate(): void {
  try {
    navigator.vibrate?.([400, 150, 400, 150, 800]);
  } catch {
    // Unsupported (e.g. iOS Safari).
  }
}

let lock: { release(): Promise<void> } | null = null;

export async function keepAwake(on: boolean): Promise<void> {
  try {
    if (on && !lock && 'wakeLock' in navigator) {
      lock = await (navigator as Navigator & { wakeLock: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock.request('screen');
    } else if (!on && lock) {
      await lock.release();
      lock = null;
    }
  } catch {
    lock = null;
  }
}
