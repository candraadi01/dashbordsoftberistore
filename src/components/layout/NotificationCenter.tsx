"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Bell,
  Check,
  CheckCircle2,
  Clock,
  Clock3,
  ShoppingCart,
  X,
  XCircle,
} from "lucide-react";
import { transactionRealtimeService } from "@/services/transactionRealtimeService";
import { useSettings } from "@/hooks/useSettings";
import {
  autoUnlockAudioOnGesture,
  isAudioReady,
  playNotificationSound,
  unlockAudioContext,
} from "@/lib/notificationSound";
import { supabase } from "@/lib/supabase";
import { TransactionRow } from "@/types";
import { cn } from "@/lib/utils";

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

export function NotificationCenter() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [activeToast, setActiveToast] = useState<AppNotification | null>(null);
  const { settings, isLoaded } = useSettings();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const recentEventsRef = useRef<Map<string, number>>(new Map());
  const toastTimerRef = useRef<number | null>(null);
  const unreadCount = notifications.filter((notification) => !notification.read).length;

  // Auto unlock audio on any user interaction and load recent transactions feed
  useEffect(() => {
    autoUnlockAudioOnGesture();

    let isMounted = true;
    async function loadRecentFeed() {
      try {
        const { data, error } = await supabase
          .from("transactions")
          .select("id, transaction_id, customer_name, product_name, status, created_at, updated_at")
          .order("created_at", { ascending: false })
          .limit(10);

        if (!error && data && isMounted) {
          const feed: AppNotification[] = data.map((item) => {
            const status = item.status as TransactionRow["status"];
            const statusLabel = status === "success" ? "Berhasil" : status === "cancelled" ? "Gagal" : "Pending";
            const transactionId = item.transaction_id || item.id.slice(0, 8).toUpperCase();
            const customer = item.customer_name || "Customer";
            const product = item.product_name || "Produk";

            return {
              id: `init:${item.id}:${status}`,
              type: "INSERT",
              status,
              title: status === "pending" ? "Transaksi baru" : `Status ${statusLabel}`,
              message: `${customer} memesan ${product} · ${transactionId}`,
              time: new Date(item.created_at || Date.now()),
              read: true,
              searchKey: item.transaction_id || item.id,
            };
          });

          setNotifications((prev) => {
            const existing = new Set(prev.map((p) => p.id));
            const fresh = feed.filter((f) => !existing.has(f.id));
            return [...prev, ...fresh];
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

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      // Do not close if clicking inside the desktop dropdown or mobile sheet
      if (dropdownRef.current && dropdownRef.current.contains(target)) return;
      if (sheetRef.current && sheetRef.current.contains(target)) return;
      setIsOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setCurrentTime(Date.now());
    const interval = window.setInterval(() => setCurrentTime(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, [isOpen]);

  useEffect(() => {
    if (!isLoaded || !settings.notificationEnabled) return;

    const channel = transactionRealtimeService.subscribeTransactions((payload) => {
      const isInsert = payload.eventType === "INSERT";
      const isUpdate = payload.eventType === "UPDATE";
      if (!isInsert && !isUpdate) return;

      const data = payload.new as TransactionRow;
      if (!data || !data.id) return;

      const status = data.status;

      if (isInsert && !settings.notificationNewTransaction) return;
      if (isUpdate) {
        // payload.old may only contain the PK when REPLICA IDENTITY is DEFAULT.
        // We use it when available, but we don't skip notifications when it's missing.
        const oldData = (payload.old && typeof payload.old === "object" && "status" in payload.old)
          ? payload.old as Partial<TransactionRow>
          : null;

        // If we have old data and the status didn't change, skip
        if (oldData && oldData.status === status) return;

        if (status === "success" && !settings.notificationStatusSuccess) return;
        if (status === "pending" && !settings.notificationStatusPending) return;
        if (status === "cancelled" && !settings.notificationStatusCancelled) return;
      }

      const eventKey = `${payload.eventType}:${data.id}:${status}:${data.updated_at}`;
      const now = Date.now();
      const lastSeen = recentEventsRef.current.get(eventKey);
      if (lastSeen && now - lastSeen < 10_000) return;
      recentEventsRef.current.set(eventKey, now);
      for (const [key, timestamp] of recentEventsRef.current) {
        if (now - timestamp > 60_000) recentEventsRef.current.delete(key);
      }

      const transactionId = data.transaction_id || data.id.slice(0, 8).toUpperCase();
      const customer = data.customer_name || "Customer";
      const product = data.product_name || "Produk";
      const statusLabel = status === "success" ? "Berhasil" : status === "cancelled" ? "Gagal" : "Pending";

      const nextNotification: AppNotification = {
        id: eventKey,
        type: isInsert ? "INSERT" : "UPDATE",
        status: isUpdate ? status : undefined,
        title: isInsert ? "Transaksi baru" : `Status ${statusLabel}`,
        message: isInsert
          ? `${customer} memesan ${product} · ${transactionId}`
          : `Pesanan ${transactionId} milik ${customer} menjadi ${statusLabel}.`,
        time: new Date(),
        read: false,
        searchKey: data.transaction_id || data.id,
      };

      setNotifications((previous) => [nextNotification, ...previous].slice(0, 30));

      // Show mobile/desktop floating toast popup banner
      setActiveToast(nextNotification);
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = window.setTimeout(() => setActiveToast(null), 8000);

      // Play sound with vibration for mobile
      if (settings.soundAlert && settings.notificationSound !== "silent") {
        void playNotificationSound(
          settings.notificationSound,
          settings.notificationVolume,
          settings.customNotificationAudio
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
          // Ignored if browser prevents notification
        }
      }
    });

    return () => transactionRealtimeService.unsubscribe(channel);
  }, [
    isLoaded,
    settings.notificationEnabled,
    settings.notificationNewTransaction,
    settings.notificationStatusSuccess,
    settings.notificationStatusPending,
    settings.notificationStatusCancelled,
    settings.soundAlert,
    settings.notificationSound,
    settings.notificationVolume,
    settings.customNotificationAudio,
  ]);

  const handleNotificationClick = (notification: AppNotification) => {
    // 1. Pesan langsung hilang dari daftar notifikasi ketika di-klik
    setNotifications((previous) => previous.filter((item) => item.id !== notification.id));
    setIsOpen(false);
    setActiveToast(null);

    // 2. Redirect ke halaman transaksi sesuai transaksi yang di-klik
    const query = encodeURIComponent(notification.searchKey);
    router.push(`/dashboard/transactions?search=${query}`);
  };

  const markAllAsRead = (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    // Pesan langsung dibersihkan/hilang saat ditandai telah dibaca
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
      </button>      {isOpen && (
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
                className="fixed inset-x-0 bottom-0 z-[101] flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl sm:hidden"
              >
            {/* Handle bar */}
            <div className="flex justify-center pb-1 pt-3" onClick={() => setIsOpen(false)}>
              <span className="h-1.5 w-10 rounded-full bg-slate-300" />
            </div>
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 px-5 py-3">
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-black text-slate-950">Notifikasi</h3>
                <p className="text-xs font-medium text-slate-500">Aktivitas transaksi secara realtime</p>
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

            {/* Sub-bar: Status dan Tombol Tandai Semua Dibaca - PASTI MUNCUL di mobile */}
            {notifications.length > 0 && (
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-5 py-2.5 text-xs">
                <span className="font-semibold text-slate-600">
                  {unreadCount > 0 ? (
                    <span className="flex items-center gap-1.5 font-bold text-indigo-700">
                      <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
                      {unreadCount} transaksi belum dibaca
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

            {/* Content */}
            <div className="flex-1 overflow-y-auto overscroll-contain">
              {notifications.length === 0 ? (
                <div className="px-5 py-14 text-center">
                  <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-slate-100 text-slate-400">
                    <Bell className="h-7 w-7" />
                  </span>
                  <p className="mt-4 text-base font-bold text-slate-700">Belum ada notifikasi baru</p>
                  <p className="mt-1.5 text-sm text-slate-500">Aktivitas transaksi akan muncul secara realtime di sini.</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {notifications.map((notification) => {
                    const iconData = notificationIcon(notification);
                    const Icon = iconData.icon;
                    return (
                      <button
                        type="button"
                        key={notification.id}
                        onClick={() => handleNotificationClick(notification)}
                        className={cn(
                          "flex w-full gap-3 px-5 py-4 text-left transition hover:bg-slate-50 active:bg-slate-100",
                          !notification.read && "bg-indigo-50/35"
                        )}
                      >
                        <span className={cn("mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-xl border", iconData.style)}>
                          <Icon className="h-5 w-5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2 text-[15px] font-bold text-slate-800">
                            {notification.title}
                            {!notification.read && <span className="h-2 w-2 rounded-full bg-indigo-500" />}
                          </span>
                          <span className="mt-1 block text-sm leading-5 text-slate-500">{notification.message}</span>
                          <span className="mt-1.5 flex items-center gap-1 text-xs font-medium text-slate-400">
                            <Clock className="h-3.5 w-3.5" /> {getTimeAgo(notification.time)}
                          </span>
                        </span>
                      </button>
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
                <h3 className="text-sm font-black text-slate-950">Notifikasi</h3>
                <p className="text-[11px] font-medium text-slate-500">Aktivitas transaksi secara realtime</p>
              </div>
              {notifications.length > 0 && (
                <button
                  type="button"
                  onClick={markAllAsRead}
                  className="flex min-h-8 items-center gap-1 rounded-lg px-2 text-xs font-bold text-indigo-600 transition hover:bg-indigo-50"
                >
                  <Check className="h-3.5 w-3.5" /> Tandai semua dibaca
                </button>
              )}
            </div>

            <div className="max-h-[min(65vh,420px)] overflow-y-auto overscroll-contain">
              {notifications.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400">
                    <Bell className="h-5 w-5" />
                  </span>
                  <p className="mt-3 text-sm font-bold text-slate-700">Belum ada notifikasi baru</p>
                  <p className="mt-1 text-xs text-slate-500">Aktivitas transaksi akan muncul secara realtime di sini.</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {notifications.map((notification) => {
                    const iconData = notificationIcon(notification);
                    const Icon = iconData.icon;
                    return (
                      <button
                        type="button"
                        key={notification.id}
                        onClick={() => handleNotificationClick(notification)}
                        className={cn(
                          "flex w-full gap-3 px-4 py-3 text-left transition hover:bg-slate-50 active:bg-slate-100",
                          !notification.read && "bg-indigo-50/35"
                        )}
                      >
                        <span className={cn("mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border", iconData.style)}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2 text-sm font-bold text-slate-800">
                            {notification.title}
                            {!notification.read && <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />}
                          </span>
                          <span className="mt-0.5 block text-xs leading-5 text-slate-500">{notification.message}</span>
                          <span className="mt-1 flex items-center gap-1 text-[10px] font-medium text-slate-400">
                            <Clock className="h-3 w-3" /> {getTimeAgo(notification.time)}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Mobile & Desktop Floating Notification Toast Banner */}
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
              <div className="mt-2.5 flex items-center justify-between">
                <span className="flex items-center gap-1 text-[10px] text-slate-400">
                  <Clock className="h-3 w-3" /> Baru saja
                </span>
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
