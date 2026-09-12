"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Bell,
  BellOff,
  Check,
  CheckCircle2,
  Clock,
  Clock3,
  ExternalLink,
  Loader2,
  ShoppingCart,
  Smartphone,
  X,
  XCircle,
} from "lucide-react";
import { transactionRealtimeService } from "@/services/transactionRealtimeService";
import { useSettings } from "@/hooks/useSettings";
import {
  autoUnlockAudioOnGesture,
  playNotificationSound,
} from "@/lib/notificationSound";
import { supabase } from "@/lib/supabase";
import { TransactionRow } from "@/types";
import { cn } from "@/lib/utils";
import { usePushNotification } from "@/hooks/usePushNotification";

export interface AppNotification {
  id: string;
  type: "INSERT" | "UPDATE";
  status?: TransactionRow["status"];
  title: string;
  message: string;
  time: Date;
  read: boolean;
  searchKey: string;
}

const READ_NOTIFICATIONS_KEY = "softberystore_read_notification_ids";

function getReadIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(READ_NOTIFICATIONS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function saveReadIds(set: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    const arr = Array.from(set).slice(-300); // keep at most 300 recent read IDs
    localStorage.setItem(READ_NOTIFICATIONS_KEY, JSON.stringify(arr));
  } catch {
    // ignore
  }
}

export function NotificationCenter() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [activeToast, setActiveToast] = useState<AppNotification | null>(null);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const { settings, isLoaded } = useSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const dropdownRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const recentEventsRef = useRef<Map<string, number>>(new Map());
  const toastTimerRef = useRef<number | null>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  // Push notification native ke HP
  const push = usePushNotification();


  useEffect(() => {
    autoUnlockAudioOnGesture();
    const initialRead = getReadIds();
    setReadIds(initialRead);

    let isMounted = true;
    async function loadRecentFeed() {
      try {
        const { data, error } = await supabase
          .from("transactions")
          .select("id, transaction_id, customer_name, product_name, status, created_at, updated_at")
          .order("created_at", { ascending: false })
          .limit(15);

        if (!error && data && isMounted) {
          const feed: AppNotification[] = [];
          for (const item of data) {
            const status = item.status as TransactionRow["status"];
            const statusLabel = status === "success" ? "Berhasil" : status === "cancelled" ? "Gagal" : "Pending";
            const transactionId = item.transaction_id || item.id.slice(0, 8).toUpperCase();
            const customer = item.customer_name || "Customer";
            const product = item.product_name || "Produk";
            const id = `init:${item.id}:${status}`;
            const searchKey = item.transaction_id || item.id;

            // If already marked as read/dismissed, skip (artinya notifikasi hilang)
            if (initialRead.has(id) || initialRead.has(item.id) || initialRead.has(searchKey)) {
              continue;
            }

            feed.push({
              id,
              type: "INSERT",
              status,
              title: status === "pending" ? "Transaksi baru" : `Status ${statusLabel}`,
              message: `${customer} memesan ${product} · ${transactionId}`,
              time: new Date(item.created_at || Date.now()),
              read: false,
              searchKey,
            });
          }

          setNotifications((prev) => {
            const existing = new Set(prev.map((p) => p.id));
            const fresh = feed.filter((f) => !existing.has(f.id));
            return [...prev, ...fresh].slice(0, 30);
          });
        }
      } catch (e) {
        console.warn("[NotificationCenter] Failed to fetch initial notifications:", e);
      }
    }

    void loadRecentFeed();

    return () => {
      isMounted = false;
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Close dropdown or sheet when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (dropdownRef.current && dropdownRef.current.contains(target)) return;
      if (sheetRef.current && sheetRef.current.contains(target)) return;
      setIsOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Refresh relative time every 30s when opened
  useEffect(() => {
    if (!isOpen) return;
    setCurrentTime(Date.now());
    const interval = window.setInterval(() => setCurrentTime(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, [isOpen]);

  // Realtime subscription hub
  useEffect(() => {
    if (!isLoaded) return;

    const channel = transactionRealtimeService.subscribeTransactions((payload) => {
      const currentSettings = settingsRef.current;
      if (!currentSettings.notificationEnabled) return;

      const isInsert = payload.eventType === "INSERT";
      const isUpdate = payload.eventType === "UPDATE";
      if (!isInsert && !isUpdate) return;

      const data = (payload.new || payload.old) as TransactionRow;
      if (!data || !data.id) return;

      const status = data.status;

      if (isInsert && !currentSettings.notificationNewTransaction) return;
      if (isUpdate) {
        const oldData = (payload.old && typeof payload.old === "object" && "status" in payload.old)
          ? payload.old as Partial<TransactionRow>
          : null;

        if (oldData && oldData.status === status) return;
        if (status === "success" && !currentSettings.notificationStatusSuccess) return;
        if (status === "pending" && !currentSettings.notificationStatusPending) return;
        if (status === "cancelled" && !currentSettings.notificationStatusCancelled) return;
      }

      const eventKey = `${payload.eventType}:${data.id}:${status}:${data.updated_at || data.created_at}`;
      const now = Date.now();
      const lastSeen = recentEventsRef.current.get(eventKey);
      if (lastSeen && now - lastSeen < 8_000) return;
      recentEventsRef.current.set(eventKey, now);
      for (const [key, timestamp] of recentEventsRef.current) {
        if (now - timestamp > 60_000) recentEventsRef.current.delete(key);
      }

      const transactionId = data.transaction_id || data.id.slice(0, 8).toUpperCase();
      const customer = data.customer_name || "Customer";
      const product = data.product_name || "Produk";
      const statusLabel = status === "success" ? "Berhasil" : status === "cancelled" ? "Gagal" : "Pending";
      const searchKey = data.transaction_id || data.id;

      // Check if user already dismissed this transaction
      const currentReadIds = getReadIds();
      if (currentReadIds.has(eventKey) || currentReadIds.has(data.id) || currentReadIds.has(searchKey)) {
        return;
      }

      const nextNotification: AppNotification = {
        id: eventKey,
        type: isInsert ? "INSERT" : "UPDATE",
        status: isUpdate ? status : undefined,
        title: isInsert ? "Transaksi baru masuk" : `Status ${statusLabel}`,
        message: isInsert
          ? `${customer} memesan ${product} · ${transactionId}`
          : `Pesanan ${transactionId} milik ${customer} menjadi ${statusLabel}.`,
        time: new Date(),
        read: false,
        searchKey,
      };

      setNotifications((previous) => [nextNotification, ...previous.filter((p) => p.id !== eventKey)].slice(0, 30));

      // Show floating toast banner
      setActiveToast(nextNotification);
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = window.setTimeout(() => setActiveToast(null), 8000);

      // Play sound
      if (currentSettings.soundAlert && currentSettings.notificationSound !== "silent") {
        void playNotificationSound(
          currentSettings.notificationSound,
          currentSettings.notificationVolume,
          currentSettings.customNotificationAudio
        ).catch((error) => console.warn("[NotificationCenter] Could not play notification sound", error));
      }

      // Trigger browser desktop notification if permission granted
      if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
        try {
          new Notification(nextNotification.title, {
            body: nextNotification.message,
            icon: "/brand/softberystore-logo.png",
          });
        } catch {
          // ignore
        }
      }
    });

    return () => {
      transactionRealtimeService.unsubscribe(channel);
    };
  }, [isLoaded]);

  // Click card -> Mark as read (hilang) and navigate to Transactions
  const handleNotificationClick = (notification: AppNotification) => {
    dismissNotification(notification);
    setIsOpen(false);
    setActiveToast(null);

    const query = encodeURIComponent(notification.searchKey);
    router.push(`/dashboard/transactions?search=${query}`);
  };

  // Single dismiss: "Tandai telah dibaca" -> Notifikasi langsung hilang
  const dismissNotification = (notification: AppNotification, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    setNotifications((prev) => prev.filter((item) => item.id !== notification.id));
    if (activeToast?.id === notification.id) {
      setActiveToast(null);
    }

    setReadIds((prev) => {
      const next = new Set(prev);
      next.add(notification.id);
      next.add(notification.searchKey);
      saveReadIds(next);
      return next;
    });
  };

  // Mark all as read: Bersihkan semua notifikasi
  const markAllAsRead = (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    setReadIds((prev) => {
      const next = new Set(prev);
      for (const n of notifications) {
        next.add(n.id);
        next.add(n.searchKey);
      }
      saveReadIds(next);
      return next;
    });

    setNotifications([]);
    setActiveToast(null);
  };

  const getTimeAgo = (date: Date) => {
    if (!currentTime) return "Baru saja";
    const seconds = Math.floor((currentTime - date.getTime()) / 1000);
    if (seconds < 60) return "Baru saja";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} mnt lalu`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} jam lalu`;
    return date.toLocaleDateString("id-ID");
  };

  const notificationIcon = (notification: AppNotification) => {
    if (notification.type === "INSERT") {
      return { icon: ShoppingCart, style: "border-indigo-200 bg-indigo-50 text-indigo-600" };
    }
    if (notification.status === "success") {
      return { icon: CheckCircle2, style: "border-emerald-200 bg-emerald-50 text-emerald-600" };
    }
    if (notification.status === "cancelled") {
      return { icon: XCircle, style: "border-rose-200 bg-rose-50 text-rose-600" };
    }
    return { icon: Clock3, style: "border-amber-200 bg-amber-50 text-amber-600" };
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        className="relative grid h-11 w-11 place-items-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 active:scale-95"
        aria-label={`Notifikasi${unreadCount ? `, ${unreadCount} belum dibaca` : ""}`}
        aria-expanded={isOpen}
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute right-1.5 top-1.5 grid min-h-4 min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-black leading-none text-white ring-2 ring-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          {/* Mobile: Bottom sheet via Portal */}
          {typeof document !== "undefined" && createPortal(
            <>
              <div
                className="fixed inset-0 z-[100] bg-slate-950/40 backdrop-blur-[2px] sm:hidden"
                onClick={() => setIsOpen(false)}
                aria-hidden="true"
              />
              <div
                ref={sheetRef}
                onClick={(e) => e.stopPropagation()}
                className="fixed inset-x-0 bottom-0 z-[101] flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl sm:hidden"
              >
                {/* Handle bar */}
                <div className="flex justify-center pb-1 pt-3" onClick={() => setIsOpen(false)}>
                  <span className="h-1.5 w-10 rounded-full bg-slate-300" />
                </div>

                {/* Header */}
                <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-black text-slate-950">Notifikasi</h3>
                      <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Realtime
                      </span>
                    </div>
                    <p className="text-xs font-medium text-slate-500">Aktivitas transaksi langsung otomatis</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                    aria-label="Tutup notifikasi"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Sub-bar: Status dan Tombol Tandai Semua Dibaca */}
                {notifications.length > 0 && (
                  <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-5 py-2.5 text-xs">
                    <span className="font-semibold text-slate-600">
                      {unreadCount > 0 ? (
                        <span className="flex items-center gap-1.5 font-bold text-indigo-700">
                          <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
                          {unreadCount} transaksi baru
                        </span>
                      ) : (
                        "Semua transaksi sudah dibaca"
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={markAllAsRead}
                      className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-indigo-600 shadow-xs transition hover:bg-indigo-50 active:scale-95"
                    >
                      <Check className="h-3.5 w-3.5" /> Tandai semua dibaca
                    </button>
                  </div>
                )}

                {/* Banner Aktivasi Notifikasi HP */}
                {push.isSupported && push.status !== "granted" && push.status !== "denied" && push.status !== "unsupported" && (
                  <div className="flex items-center gap-3 border-b border-indigo-100 bg-indigo-50 px-5 py-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-indigo-600 text-white shadow-sm">
                      <Smartphone className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-slate-900">Aktifkan notifikasi HP</p>
                      <p className="text-[11px] text-slate-500">Terima notifikasi meski browser tertutup</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void push.subscribe()}
                      disabled={push.status === "loading"}
                      className="flex shrink-0 items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-indigo-700 active:scale-95 disabled:opacity-60"
                    >
                      {push.status === "loading" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Bell className="h-3.5 w-3.5" />
                      )}
                      {push.status === "loading" ? "Menghubungkan..." : "Aktifkan"}
                    </button>
                  </div>
                )}

                {/* Banner: Notifikasi HP Aktif */}
                {push.status === "granted" && (
                  <div className="flex items-center gap-3 border-b border-emerald-100 bg-emerald-50 px-5 py-2.5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-600">
                      <Smartphone className="h-4 w-4" />
                    </span>
                    <p className="min-w-0 flex-1 text-xs font-semibold text-emerald-700">
                      Notifikasi HP aktif ✓
                    </p>
                    <button
                      type="button"
                      onClick={() => void push.unsubscribe()}
                      className="flex shrink-0 items-center gap-1 rounded-lg border border-emerald-200 bg-white px-2 py-1 text-[11px] font-semibold text-emerald-700 transition hover:bg-emerald-100 active:scale-95"
                    >
                      <BellOff className="h-3 w-3" /> Matikan
                    </button>
                  </div>
                )}

                {/* Banner: Izin ditolak */}
                {push.status === "denied" && (
                  <div className="flex items-center gap-3 border-b border-amber-100 bg-amber-50 px-5 py-2.5">
                    <BellOff className="h-4 w-4 shrink-0 text-amber-600" />
                    <p className="text-xs font-medium text-amber-700">
                      Notifikasi HP diblokir. Buka Pengaturan browser untuk mengizinkan.
                    </p>
                  </div>
                )}



                {/* Content List */}
                <div className="flex-1 overflow-y-auto overscroll-contain">
                  {notifications.length === 0 ? (
                    <div className="px-5 py-14 text-center">
                      <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-slate-100 text-slate-400">
                        <Bell className="h-7 w-7" />
                      </span>
                      <p className="mt-4 text-base font-bold text-slate-700">Belum ada notifikasi baru</p>
                      <p className="mt-1.5 text-xs text-slate-500">
                        Semua transaksi telah dibaca atau belum ada transaksi baru. Transaksi masuk akan otomatis muncul di sini secara realtime.
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {notifications.map((notification) => {
                        const iconData = notificationIcon(notification);
                        const Icon = iconData.icon;
                        return (
                          <div
                            key={notification.id}
                            className={cn(
                              "flex flex-col gap-2.5 px-5 py-4 transition hover:bg-slate-50",
                              !notification.read ? "bg-indigo-50/40" : "bg-white"
                            )}
                          >
                            <div
                              onClick={() => handleNotificationClick(notification)}
                              className="flex cursor-pointer items-start gap-3"
                            >
                              <span className={cn("mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-xl border shadow-xs", iconData.style)}>
                                <Icon className="h-5 w-5" />
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                                    {notification.title}
                                    {!notification.read && <span className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />}
                                  </span>
                                  <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-slate-400">
                                    <Clock className="h-3 w-3" /> {getTimeAgo(notification.time)}
                                  </span>
                                </div>
                                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                                  {notification.message}
                                </p>
                              </div>
                            </div>

                            {/* Tombol kecil "Tandai telah di baca" di mobile agar notifikasi langsung hilang */}
                            <div className="flex items-center justify-between pt-1 pl-14">
                              <button
                                type="button"
                                onClick={(e) => dismissNotification(notification, e)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 shadow-xs transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600 active:scale-95"
                              >
                                <Check className="h-3.5 w-3.5 text-emerald-600" />
                                <span>Tandai telah dibaca</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleNotificationClick(notification)}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:underline"
                              >
                                <span>Lihat detail</span>
                                <ExternalLink className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </>,
            document.body
          )}

          {/* Desktop: Dropdown */}
          <div className="absolute right-0 z-[65] mt-2 hidden w-96 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl sm:block">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-black text-slate-950">Notifikasi</h3>
                  <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">
                    <span className="h-1 w-1 rounded-full bg-emerald-500 animate-pulse" />
                    Realtime
                  </span>
                </div>
                <p className="text-[11px] font-medium text-slate-500">Aktivitas transaksi secara realtime</p>
              </div>
              {notifications.length > 0 && (
                <button
                  type="button"
                  onClick={markAllAsRead}
                  className="flex min-h-8 items-center gap-1 rounded-lg px-2 text-xs font-bold text-indigo-600 transition hover:bg-indigo-50 active:scale-95"
                >
                  <Check className="h-3.5 w-3.5" /> Tandai semua dibaca
                </button>
              )}
            </div>

            {/* Desktop: Banner Aktivasi Notifikasi HP */}
            {push.isSupported && push.status !== "granted" && push.status !== "denied" && push.status !== "unsupported" && (
              <div className="flex items-center gap-2.5 border-b border-indigo-100 bg-indigo-50/80 px-4 py-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-indigo-600 text-white">
                  <Smartphone className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold text-slate-900">Aktifkan notifikasi HP</p>
                  <p className="text-[10px] text-slate-500">Muncul meski browser tertutup</p>
                </div>
                <button
                  type="button"
                  onClick={() => void push.subscribe()}
                  disabled={push.status === "loading"}
                  className="flex shrink-0 items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[11px] font-bold text-white transition hover:bg-indigo-700 active:scale-95 disabled:opacity-60"
                >
                  {push.status === "loading" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bell className="h-3 w-3" />}
                  {push.status === "loading" ? "..." : "Aktifkan"}
                </button>
              </div>
            )}
            {push.status === "granted" && (
              <div className="flex items-center gap-2 border-b border-emerald-100 bg-emerald-50 px-4 py-2">
                <Smartphone className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                <p className="min-w-0 flex-1 text-[11px] font-semibold text-emerald-700">Notifikasi HP aktif ✓</p>
                <button
                  type="button"
                  onClick={() => void push.unsubscribe()}
                  className="text-[10px] font-semibold text-emerald-700 underline hover:text-emerald-900"
                >
                  Matikan
                </button>
              </div>
            )}
            {push.status === "denied" && (
              <div className="flex items-center gap-2 border-b border-amber-100 bg-amber-50 px-4 py-2">
                <BellOff className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                <p className="text-[10px] font-medium text-amber-700">Notifikasi diblokir di pengaturan browser.</p>
              </div>
            )}

            <div className="max-h-[min(65vh,420px)] overflow-y-auto overscroll-contain">
              {notifications.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400">
                    <Bell className="h-5 w-5" />
                  </span>
                  <p className="mt-3 text-sm font-bold text-slate-700">Belum ada notifikasi baru</p>
                  <p className="mt-1 text-xs text-slate-500">Semua transaksi telah dibaca. Transaksi baru akan otomatis muncul di sini.</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {notifications.map((notification) => {
                    const iconData = notificationIcon(notification);
                    const Icon = iconData.icon;
                    return (
                      <div
                        key={notification.id}
                        className={cn(
                          "group relative flex flex-col gap-2 p-3.5 transition hover:bg-slate-50",
                          !notification.read ? "bg-indigo-50/30" : "bg-white"
                        )}
                      >
                        <div
                          onClick={() => handleNotificationClick(notification)}
                          className="flex cursor-pointer items-start gap-3"
                        >
                          <span className={cn("mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border", iconData.style)}>
                            <Icon className="h-4 w-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-1">
                              <span className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                                {notification.title}
                                {!notification.read && <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />}
                              </span>
                              <span className="flex items-center gap-1 text-[10px] font-medium text-slate-400">
                                <Clock className="h-3 w-3" /> {getTimeAgo(notification.time)}
                              </span>
                            </div>
                            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{notification.message}</p>
                          </div>
                        </div>

                        {/* Tombol kecil Tandai telah dibaca */}
                        <div className="flex items-center justify-between pl-12">
                          <button
                            type="button"
                            onClick={(e) => dismissNotification(notification, e)}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600 shadow-2xs transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 active:scale-95"
                            title="Tandai telah dibaca (hilang dari notifikasi)"
                          >
                            <Check className="h-3 w-3 text-emerald-600" />
                            <span>Tandai telah dibaca</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleNotificationClick(notification)}
                            className="text-[10px] font-semibold text-indigo-600 hover:underline"
                          >
                            Buka detail →
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Floating Toast Notification Banner */}
      {typeof document !== "undefined" && activeToast && createPortal(
        <div className="fixed top-3 inset-x-3 sm:inset-x-auto sm:right-4 sm:top-4 z-[999] max-w-sm rounded-2xl border border-indigo-500/30 bg-slate-950/95 p-3.5 text-white shadow-2xl backdrop-blur-md transition-all animate-in slide-in-from-top-4 duration-300">
          <div className="flex items-start gap-3">
            <span className="relative mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-indigo-600 text-white shadow-md shadow-indigo-500/30">
              <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-ping rounded-full bg-rose-500" />
              <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-slate-950" />
              <ShoppingCart className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-black uppercase tracking-wider text-indigo-400">
                  {activeToast.title}
                </p>
                <button
                  type="button"
                  onClick={() => setActiveToast(null)}
                  className="grid h-6 w-6 place-items-center rounded-lg text-slate-400 hover:text-white"
                  aria-label="Tutup pemberitahuan"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-0.5 text-xs font-semibold leading-relaxed text-slate-100">
                {activeToast.message}
              </p>
              <div className="mt-2.5 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={(e) => dismissNotification(activeToast, e)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] font-semibold text-slate-300 hover:bg-slate-700 hover:text-white"
                >
                  <Check className="h-3 w-3 text-emerald-400" />
                  Tandai dibaca
                </button>
                <button
                  type="button"
                  onClick={() => handleNotificationClick(activeToast)}
                  className="rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-bold text-white shadow-sm hover:bg-indigo-500 active:scale-95"
                >
                  Buka Detail
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
