"use client";

import React, { ChangeEvent, useRef, useState } from "react";
import {
  BellRing,
  CheckCircle2,
  Clock3,
  Music2,
  Play,
  ShoppingCart,
  Trash2,
  Upload,
  Volume2,
  XCircle,
} from "lucide-react";
import { useSettings, SettingsState } from "@/hooks/useSettings";
import {
  NOTIFICATION_SOUND_OPTIONS,
  NotificationSoundPreset,
  playNotificationSound,
} from "@/lib/notificationSound";
import { cn } from "@/lib/utils";
import { usePushNotification } from "@/hooks/usePushNotification";

const MAX_AUDIO_BYTES = 1.5 * 1024 * 1024;

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className="relative inline-flex min-h-11 shrink-0 cursor-pointer items-center">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={label}
      />
      <span className="relative h-7 w-12 rounded-full bg-slate-300 transition peer-focus-visible:ring-4 peer-focus-visible:ring-indigo-100 peer-checked:bg-indigo-600 after:absolute after:left-1 after:top-1 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:after:translate-x-5" />
    </label>
  );
}

const EVENT_OPTIONS: Array<{
  key: keyof Pick<
    SettingsState,
    | "notificationNewTransaction"
    | "notificationStatusSuccess"
    | "notificationStatusPending"
    | "notificationStatusCancelled"
  >;
  title: string;
  description: string;
  icon: typeof ShoppingCart;
  iconStyle: string;
}> = [
  {
    key: "notificationNewTransaction",
    title: "Transaksi baru",
    description: "Saat pesanan baru masuk dari WhatsApp.",
    icon: ShoppingCart,
    iconStyle: "bg-indigo-100 text-indigo-600",
  },
  {
    key: "notificationStatusSuccess",
    title: "Status berhasil",
    description: "Saat pembayaran dikonfirmasi berhasil.",
    icon: CheckCircle2,
    iconStyle: "bg-emerald-100 text-emerald-600",
  },
  {
    key: "notificationStatusPending",
    title: "Status pending",
    description: "Saat transaksi menunggu tindakan owner.",
    icon: Clock3,
    iconStyle: "bg-amber-100 text-amber-600",
  },
  {
    key: "notificationStatusCancelled",
    title: "Status gagal",
    description: "Saat pesanan dibatalkan atau gagal.",
    icon: XCircle,
    iconStyle: "bg-rose-100 text-rose-600",
  },
];

export function NotificationPreferences() {
  const { settings, updateSetting } = useSettings();
  const push = usePushNotification();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  const selectSound = (sound: NotificationSoundPreset) => {
    updateSetting("notificationSound", sound);
    updateSetting("soundAlert", sound !== "silent");
    setMessage(null);
  };

  const testSound = async () => {
    setIsTesting(true);
    setMessage(null);
    try {
      await playNotificationSound(
        settings.notificationSound,
        settings.notificationVolume,
        settings.customNotificationAudio
      );
      if (settings.notificationSound === "silent") {
        setMessage({ type: "success", text: "Mode tanpa suara sedang dipilih." });
      }
    } catch {
      setMessage({
        type: "error",
        text: "Suara belum dapat diputar. Sentuh halaman sekali lalu coba lagi.",
      });
    } finally {
      window.setTimeout(() => setIsTesting(false), 350);
    }
  };

  const handleAudioUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!file.type.startsWith("audio/")) {
      setMessage({ type: "error", text: "File harus berupa audio MP3, WAV, OGG, M4A, atau WebM." });
      return;
    }

    if (file.size > MAX_AUDIO_BYTES) {
      setMessage({ type: "error", text: "Ukuran audio maksimal 1,5 MB agar dashboard tetap ringan." });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      updateSetting("customNotificationAudio", reader.result);
      updateSetting("customNotificationAudioName", file.name);
      updateSetting("notificationSound", "custom");
      updateSetting("soundAlert", true);
      setMessage({ type: "success", text: `Audio “${file.name}” berhasil dipasang.` });
    };
    reader.onerror = () => setMessage({ type: "error", text: "File audio gagal dibaca. Silakan coba file lain." });
    reader.readAsDataURL(file);
  };

  const removeCustomAudio = () => {
    updateSetting("customNotificationAudio", null);
    updateSetting("customNotificationAudioName", "");
    if (settings.notificationSound === "custom") selectSound("soft");
    setMessage({ type: "success", text: "Audio custom berhasil dihapus." });
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:col-span-2">
      <div className="flex flex-col gap-4 border-b border-slate-200 bg-gradient-to-r from-indigo-50/70 via-white to-cyan-50/70 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/20">
            <BellRing className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-base font-black text-slate-950 sm:text-lg">Pusat notifikasi</h2>
            <p className="mt-0.5 text-xs leading-5 text-slate-500 sm:text-sm">
              Atur aktivitas yang masuk serta suara pemberitahuannya.
            </p>
          </div>
        </div>
        <div className="flex min-h-12 items-center justify-between gap-4 rounded-xl border border-indigo-100 bg-white px-4 sm:min-w-52">
          <div>
            <p className="text-sm font-bold text-slate-900">Notifikasi realtime</p>
            <p className={cn("text-xs font-semibold", settings.notificationEnabled ? "text-emerald-600" : "text-slate-400")}>
              {settings.notificationEnabled ? "Aktif" : "Nonaktif"}
            </p>
          </div>
          <Toggle
            checked={settings.notificationEnabled}
            onChange={(checked) => updateSetting("notificationEnabled", checked)}
            label="Aktifkan notifikasi realtime"
          />
        </div>
      </div>

      {/* Toggle Native OS Push Notification */}
      {push.isSupported && (
        <div className="border-b border-slate-100 bg-slate-50/50 px-4 py-4 sm:px-5">
          <div className="flex items-center justify-between gap-4 rounded-xl border border-indigo-100 bg-white p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-indigo-50 text-indigo-600">
                <BellRing className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-bold text-slate-900">Notifikasi OS / HP (Latar Belakang)</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Terima notifikasi native di layar HP meski browser/dashboard sedang ditutup.
                </p>
                {push.status === "denied" && (
                  <p className="mt-1 text-[11px] font-semibold text-rose-600">
                    Izin diblokir. Mohon izinkan notifikasi dari pengaturan browser Anda.
                  </p>
                )}
              </div>
            </div>
            <Toggle
              checked={push.status === "granted"}
              onChange={(checked) => {
                if (checked) void push.subscribe();
                else void push.unsubscribe();
              }}
              label="Aktifkan Notifikasi OS"
            />
          </div>
        </div>
      )}

      <div className={cn("space-y-6 p-4 transition-opacity sm:p-5", !settings.notificationEnabled && "opacity-55")}>
        <fieldset disabled={!settings.notificationEnabled} className="space-y-3">
          <div>
            <legend className="text-sm font-black text-slate-900">Notifikasi yang diterima</legend>
            <p className="mt-1 text-xs leading-5 text-slate-500">Matikan jenis aktivitas yang tidak ingin mengganggu Anda.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {EVENT_OPTIONS.map((option) => {
              const Icon = option.icon;
              return (
                <div key={option.key} className="flex min-h-[76px] items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-3 sm:p-4">
                  <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", option.iconStyle)}>
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-slate-900">{option.title}</p>
                    <p className="mt-0.5 text-xs leading-4 text-slate-500">{option.description}</p>
                  </div>
                  <Toggle
                    checked={settings[option.key]}
                    onChange={(checked) => updateSetting(option.key, checked)}
                    label={`Atur ${option.title}`}
                  />
                </div>
              );
            })}
          </div>
        </fieldset>

        <fieldset disabled={!settings.notificationEnabled} className="space-y-3 border-t border-slate-200 pt-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <legend className="text-sm font-black text-slate-900">Suara notifikasi</legend>
              <p className="mt-1 text-xs leading-5 text-slate-500">Pilih nada bawaan atau gunakan audio milik Anda sendiri.</p>
            </div>
            <button
              type="button"
              onClick={testSound}
              disabled={isTesting}
              className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 text-sm font-bold text-indigo-700 transition hover:bg-indigo-100 active:scale-[.98] disabled:cursor-wait"
            >
              <Play className="h-4 w-4" />
              {isTesting ? "Memutar..." : "Coba suara"}
            </button>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {NOTIFICATION_SOUND_OPTIONS.map((sound) => {
              const selected = settings.notificationSound === sound.value;
              return (
                <button
                  key={sound.value}
                  type="button"
                  onClick={() => selectSound(sound.value)}
                  aria-pressed={selected}
                  className={cn(
                    "flex min-h-[64px] items-center gap-3 rounded-xl border p-3 text-left transition active:scale-[.99]",
                    selected
                      ? "border-indigo-400 bg-indigo-50 ring-2 ring-indigo-100"
                      : "border-slate-200 bg-white hover:border-indigo-200 hover:bg-slate-50"
                  )}
                >
                  <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", selected ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500")}>
                    {sound.value === "silent" ? <Volume2 className="h-4 w-4 opacity-40" /> : <Music2 className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-slate-900">{sound.label}</span>
                    <span className="block truncate text-xs text-slate-500">{sound.description}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className={cn(
            "rounded-2xl border border-dashed p-4 transition",
            settings.notificationSound === "custom" ? "border-indigo-400 bg-indigo-50/70" : "border-slate-300 bg-slate-50"
          )}>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/webm"
              className="hidden"
              onChange={handleAudioUpload}
            />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-indigo-600 shadow-sm">
                  <Upload className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900">
                    {settings.customNotificationAudioName || "Import audio dari perangkat"}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">MP3, WAV, OGG, M4A, atau WebM · maksimal 1,5 MB</p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 min-[390px]:grid-cols-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="min-h-11 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white transition hover:bg-slate-800 active:scale-[.98]"
                >
                  {settings.customNotificationAudio ? "Ganti audio" : "Pilih audio"}
                </button>
                {settings.customNotificationAudio && (
                  <button
                    type="button"
                    onClick={removeCustomAudio}
                    className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-200 bg-white px-4 text-sm font-bold text-rose-600 transition hover:bg-rose-50 active:scale-[.98]"
                  >
                    <Trash2 className="h-4 w-4" /> Hapus
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-2xl bg-slate-50 p-4 sm:flex-row sm:items-center">
            <Volume2 className="h-5 w-5 shrink-0 text-indigo-600" />
            <label htmlFor="notification-volume" className="text-sm font-bold text-slate-800">Volume</label>
            <input
              id="notification-volume"
              type="range"
              min="0"
              max="100"
              step="5"
              value={settings.notificationVolume}
              onChange={(event) => updateSetting("notificationVolume", Number(event.target.value))}
              className="h-11 w-full accent-indigo-600 sm:h-2"
            />
            <span className="min-w-12 rounded-lg bg-white px-2 py-1 text-center text-sm font-black text-slate-700 shadow-sm">
              {settings.notificationVolume}%
            </span>
          </div>
        </fieldset>

        {message && (
          <div className={cn(
            "rounded-xl border px-4 py-3 text-sm font-semibold",
            message.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700"
          )}>
            {message.text}
          </div>
        )}
      </div>
    </section>
  );
}
