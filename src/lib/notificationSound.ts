export type NotificationSoundPreset =
  | "soft"
  | "chime"
  | "digital"
  | "pop"
  | "urgent"
  | "custom"
  | "silent";

export const NOTIFICATION_SOUND_OPTIONS: Array<{
  value: Exclude<NotificationSoundPreset, "custom">;
  label: string;
  description: string;
}> = [
  { value: "soft", label: "Lembut", description: "Nada singkat dan tenang" },
  { value: "chime", label: "Chime", description: "Dua nada yang jelas" },
  { value: "digital", label: "Digital", description: "Cocok untuk transaksi" },
  { value: "pop", label: "Pop", description: "Ringkas dan ringan" },
  { value: "urgent", label: "Prioritas", description: "Lebih tegas dan mudah terdengar" },
  { value: "silent", label: "Tanpa suara", description: "Notifikasi visual saja" },
];

type Note = {
  frequency: number;
  start: number;
  duration: number;
  gain: number;
  type?: OscillatorType;
};

const PRESET_NOTES: Record<Exclude<NotificationSoundPreset, "custom" | "silent">, Note[]> = {
  soft: [
    { frequency: 660, start: 0, duration: 0.14, gain: 0.16, type: "sine" },
    { frequency: 880, start: 0.13, duration: 0.22, gain: 0.14, type: "sine" },
  ],
  chime: [
    { frequency: 523.25, start: 0, duration: 0.2, gain: 0.18, type: "sine" },
    { frequency: 783.99, start: 0.17, duration: 0.32, gain: 0.16, type: "sine" },
  ],
  digital: [
    { frequency: 740, start: 0, duration: 0.09, gain: 0.12, type: "square" },
    { frequency: 980, start: 0.11, duration: 0.09, gain: 0.11, type: "square" },
    { frequency: 1240, start: 0.22, duration: 0.15, gain: 0.1, type: "square" },
  ],
  pop: [
    { frequency: 360, start: 0, duration: 0.08, gain: 0.15, type: "sine" },
    { frequency: 720, start: 0.06, duration: 0.16, gain: 0.12, type: "sine" },
  ],
  urgent: [
    { frequency: 880, start: 0, duration: 0.15, gain: 0.18, type: "triangle" },
    { frequency: 880, start: 0.2, duration: 0.15, gain: 0.18, type: "triangle" },
    { frequency: 1046.5, start: 0.4, duration: 0.25, gain: 0.16, type: "triangle" },
  ],
};

let sharedContext: AudioContext | null = null;
let isUnlockAttached = false;
let isAudioPrimed = false;
let primedAudioElement: HTMLAudioElement | null = null;
let cachedWavUri: string | null = null;

/**
 * Generates an in-memory 2-tone pleasant chime WAV data URI.
 * Guarantees zero-network offline sound fallback for iOS Safari and Android Chrome.
 */
function getChimeWavUri(): string {
  if (cachedWavUri) return cachedWavUri;
  if (typeof window === "undefined") return "";

  try {
    const sampleRate = 22050;
    const duration = 0.42;
    const numSamples = Math.floor(sampleRate * duration);
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    const writeString = (offset: number, text: string) => {
      for (let i = 0; i < text.length; i++) {
        view.setUint8(offset + i, text.charCodeAt(i));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, 36 + numSamples * 2, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, numSamples * 2, true);

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      let freq = 660;
      let env = 1;
      if (t < 0.16) {
        freq = 660;
        env = Math.exp(-t * 8);
      } else {
        freq = 880;
        env = Math.exp(-(t - 0.16) * 7);
      }
      const sample = Math.sin(2 * Math.PI * freq * t) * env * 0.85;
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    }

    let binary = "";
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    cachedWavUri = "data:audio/wav;base64," + btoa(binary);
    return cachedWavUri;
  } catch {
    return "";
  }
}

function getSharedAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioContextClass =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;

  if (!sharedContext || sharedContext.state === "closed") {
    try {
      sharedContext = new AudioContextClass();
    } catch {
      return null;
    }
  }
  return sharedContext;
}

/**
 * Mobile-specific unlock: iOS WebKit requires playing an actual buffer
 * inside the user gesture handler to release the audio output bus.
 */
export function unlockAudioContext(): void {
  if (typeof window === "undefined") return;

  const ctx = getSharedAudioContext();
  if (ctx) {
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    // Play micro silent buffer (required by iOS Safari)
    try {
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
    } catch {
      // Ignore
    }
  }

  // Prime fallback HTML5 Audio element for mobile
  try {
    if (!primedAudioElement) {
      const uri = getChimeWavUri();
      if (uri) {
        primedAudioElement = new Audio(uri);
        primedAudioElement.volume = 0.01;
        const playPromise = primedAudioElement.play();
        if (playPromise) {
          playPromise
            .then(() => {
              primedAudioElement?.pause();
              if (primedAudioElement) primedAudioElement.currentTime = 0;
            })
            .catch(() => {});
        }
      }
    }
  } catch {
    // Ignore
  }

  isAudioPrimed = true;
}

export function isAudioReady(): boolean {
  if (typeof window === "undefined") return false;
  const ctx = getSharedAudioContext();
  return isAudioPrimed || (ctx !== null && ctx.state === "running");
}

export function autoUnlockAudioOnGesture(onUnlocked?: () => void): void {
  if (typeof window === "undefined" || isUnlockAttached) return;
  isUnlockAttached = true;

  const unlock = () => {
    unlockAudioContext();
    if (onUnlocked) onUnlocked();
  };

  window.addEventListener("click", unlock, { passive: true });
  window.addEventListener("touchstart", unlock, { passive: true });
  window.addEventListener("touchend", unlock, { passive: true });
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock, { passive: true });
}

export function triggerHapticVibration(): void {
  if (typeof window !== "undefined" && "navigator" in window && "vibrate" in navigator) {
    try {
      navigator.vibrate([250, 100, 250, 100, 400]);
    } catch {
      // Ignore vibration error
    }
  }
}

export async function playNotificationSound(
  preset: NotificationSoundPreset,
  volume = 65,
  customAudio?: string | null
) {
  if (typeof window === "undefined" || preset === "silent" || volume <= 0) return;
  const volumeMultiplier = Math.min(1, Math.max(0, volume / 100));

  // Trigger phone vibration for mobile alerts
  triggerHapticVibration();

  // Custom audio playback
  if (preset === "custom" && customAudio) {
    try {
      const audio = new Audio(customAudio);
      audio.volume = volumeMultiplier;
      await audio.play();
      return;
    } catch (e) {
      console.warn("[NotificationSound] Custom audio failed, falling back to chime:", e);
    }
  }

  const selectedPreset = preset === "custom" ? "soft" : preset;
  const context = getSharedAudioContext();
  let webAudioSuccess = false;

  if (context) {
    try {
      if (context.state === "suspended") {
        await context.resume();
      }

      if (context.state === "running") {
        const notes = PRESET_NOTES[selectedPreset] || PRESET_NOTES.soft;
        const baseTime = context.currentTime + 0.015;

        notes.forEach((note) => {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          const startsAt = baseTime + note.start;
          const endsAt = startsAt + note.duration;

          oscillator.type = note.type ?? "sine";
          oscillator.frequency.setValueAtTime(note.frequency, startsAt);
          gain.gain.setValueAtTime(0.0001, startsAt);
          gain.gain.exponentialRampToValueAtTime(
            Math.max(0.0001, note.gain * volumeMultiplier),
            startsAt + 0.015
          );
          gain.gain.exponentialRampToValueAtTime(0.0001, endsAt);
          oscillator.connect(gain);
          gain.connect(context.destination);
          oscillator.start(startsAt);
          oscillator.stop(endsAt + 0.02);
        });
        webAudioSuccess = true;
      }
    } catch (err) {
      console.warn("[NotificationSound] WebAudio playback failed:", err);
    }
  }

  // Dual engine fallback: If WebAudio was blocked or failed on mobile, use HTML5 Audio
  if (!webAudioSuccess) {
    try {
      const wavUri = getChimeWavUri();
      if (wavUri) {
        const fallbackAudio = new Audio(wavUri);
        fallbackAudio.volume = volumeMultiplier;
        await fallbackAudio.play();
      }
    } catch (audioErr) {
      console.warn("[NotificationSound] Fallback audio playback failed:", audioErr);
    }
  }
}
