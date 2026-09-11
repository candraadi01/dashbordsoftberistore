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
    { frequency: 660, start: 0, duration: 0.14, gain: 0.12, type: "sine" },
    { frequency: 880, start: 0.13, duration: 0.18, gain: 0.1, type: "sine" },
  ],
  chime: [
    { frequency: 523.25, start: 0, duration: 0.2, gain: 0.13, type: "sine" },
    { frequency: 783.99, start: 0.17, duration: 0.28, gain: 0.12, type: "sine" },
  ],
  digital: [
    { frequency: 740, start: 0, duration: 0.09, gain: 0.09, type: "square" },
    { frequency: 980, start: 0.11, duration: 0.09, gain: 0.08, type: "square" },
    { frequency: 1240, start: 0.22, duration: 0.12, gain: 0.07, type: "square" },
  ],
  pop: [
    { frequency: 360, start: 0, duration: 0.08, gain: 0.12, type: "sine" },
    { frequency: 720, start: 0.06, duration: 0.13, gain: 0.09, type: "sine" },
  ],
  urgent: [
    { frequency: 880, start: 0, duration: 0.15, gain: 0.13, type: "triangle" },
    { frequency: 880, start: 0.2, duration: 0.15, gain: 0.13, type: "triangle" },
    { frequency: 1046.5, start: 0.4, duration: 0.2, gain: 0.12, type: "triangle" },
  ],
};

let sharedContext: AudioContext | null = null;
let isUnlockAttached = false;

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

export function unlockAudioContext(): void {
  if (typeof window === "undefined") return;
  const ctx = getSharedAudioContext();
  if (ctx && ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
}

export function autoUnlockAudioOnGesture(): void {
  if (typeof window === "undefined" || isUnlockAttached) return;
  isUnlockAttached = true;

  const unlock = () => {
    unlockAudioContext();
  };

  window.addEventListener("click", unlock, { passive: true });
  window.addEventListener("touchstart", unlock, { passive: true });
  window.addEventListener("keydown", unlock, { passive: true });
}

export async function playNotificationSound(
  preset: NotificationSoundPreset,
  volume = 65,
  customAudio?: string | null
) {
  if (typeof window === "undefined" || preset === "silent" || volume <= 0) return;
  const volumeMultiplier = Math.min(1, Math.max(0, volume / 100));

  if (preset === "custom" && customAudio) {
    try {
      const audio = new Audio(customAudio);
      audio.volume = volumeMultiplier;
      await audio.play();
      return;
    } catch (e) {
      console.warn("[NotificationSound] Custom audio playback failed:", e);
    }
  }

  const selectedPreset = preset === "custom" ? "soft" : preset;
  const context = getSharedAudioContext();
  if (!context) return;

  try {
    if (context.state === "suspended") {
      await context.resume();
    }
  } catch {
    // If resume fails due to autoplay policy, will continue to attempt or catch below
  }

  const notes = PRESET_NOTES[selectedPreset] || PRESET_NOTES.soft;
  const baseTime = context.currentTime + 0.015;

  try {
    notes.forEach((note) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const startsAt = baseTime + note.start;
      const endsAt = startsAt + note.duration;

      oscillator.type = note.type ?? "sine";
      oscillator.frequency.setValueAtTime(note.frequency, startsAt);
      gain.gain.setValueAtTime(0.0001, startsAt);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, note.gain * volumeMultiplier), startsAt + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, endsAt);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startsAt);
      oscillator.stop(endsAt + 0.02);
    });
  } catch (err) {
    console.warn("[NotificationSound] Web Audio note playback error:", err);
  }
}
