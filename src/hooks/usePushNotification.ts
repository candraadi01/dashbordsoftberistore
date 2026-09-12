"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export type PushStatus =
  | "unsupported"   // Browser tidak support push
  | "checking"      // Sedang cek status
  | "denied"        // User menolak izin
  | "granted"       // Sudah aktif
  | "default"       // Belum ada keputusan
  | "loading";      // Sedang proses subscribe/unsubscribe

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray.buffer;
}

async function getAuthToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? "";
}

export function usePushNotification() {
  const [status, setStatus] = useState<PushStatus>("checking");
  const [endpoint, setEndpoint] = useState<string | null>(null);

  const isSupported =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    Boolean(VAPID_PUBLIC_KEY);

  // ── Cek status awal ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!isSupported) {
      setStatus("unsupported");
      return;
    }

    async function checkStatus() {
      try {
        const permission = Notification.permission;
        if (permission === "denied") { setStatus("denied"); return; }

        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();

        if (sub) {
          setEndpoint(sub.endpoint);
          setStatus("granted");
        } else if (permission === "granted") {
          // Permission granted tapi belum ada subscription
          setStatus("default");
        } else {
          setStatus("default");
        }
      } catch {
        setStatus("default");
      }
    }

    void checkStatus();
  }, [isSupported]);

  // ── Subscribe ────────────────────────────────────────────────────────────
  const subscribe = useCallback(async () => {
    if (!isSupported) return;
    setStatus("loading");
    try {
      // 1. Minta izin notifikasi
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "default");
        return;
      }

      // 2. Daftarkan service worker
      const reg = await navigator.serviceWorker.ready;

      // 3. Subscribe ke push
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      // 4. Kirim subscription ke server
      const token = await getAuthToken();
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(sub.toJSON()),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Gagal menyimpan subscription");
      }

      setEndpoint(sub.endpoint);
      setStatus("granted");
    } catch (err) {
      console.error("[usePushNotification] subscribe error:", err);
      // Jika sudah ada sub tapi gagal simpan ke server, tetap anggap granted
      try {
        const reg = await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        if (existing) { setEndpoint(existing.endpoint); setStatus("granted"); return; }
      } catch { /* ignore */ }
      setStatus("default");
    }
  }, [isSupported]);

  // ── Unsubscribe ──────────────────────────────────────────────────────────
  const unsubscribe = useCallback(async () => {
    if (!isSupported) return;
    setStatus("loading");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();

      if (sub) {
        // Hapus dari server
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        // Hapus dari browser
        await sub.unsubscribe();
      }

      setEndpoint(null);
      setStatus("default");
    } catch (err) {
      console.error("[usePushNotification] unsubscribe error:", err);
      setStatus("granted"); // revert
    }
  }, [isSupported]);

  return { status, endpoint, isSupported, subscribe, unsubscribe };
}
