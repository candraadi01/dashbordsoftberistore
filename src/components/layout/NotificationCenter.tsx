"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bell,
  Check,
  CheckCircle2,
  Clock,
  Clock3,
  ShoppingCart,
  XCircle,
} from "lucide-react";
import { transactionRealtimeService } from "@/services/transactionRealtimeService";
import { useSettings } from "@/hooks/useSettings";
import { playNotificationSound } from "@/lib/notificationSound";
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
}

export function NotificationCenter() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const { settings, isLoaded } = useSettings();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const recentEventsRef = useRef<Map<string, number>>(new Map());
  const unreadCount = notifications.filter((notification) => !notification.read).length;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
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
      const oldData = payload.old as Partial<TransactionRow>;
      const status = data.status;

      if (isInsert && !settings.notificationNewTransaction) return;
      if (isUpdate) {
        if (oldData.status === status) return;
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
      };

      setNotifications((previous) => [nextNotification, ...previous].slice(0, 30));
      if (settings.soundAlert && settings.notificationSound !== "silent") {
        void playNotificationSound(
          settings.notificationSound,
          settings.notificationVolume,
          settings.customNotificationAudio
        ).catch((error) => console.warn("Could not play notification sound", error));
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

  const markAllAsRead = () => {
    setNotifications((previous) => previous.map((notification) => ({ ...notification, read: true })));
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
              <div className="fixed inset-x-0 bottom-0 z-[101] flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl sm:hidden">
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
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={markAllAsRead}
                    className="flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-xs font-bold text-indigo-600 transition hover:bg-indigo-50"
                  >
                    <Check className="h-3.5 w-3.5" /> Tandai dibaca
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="grid h-10 w-10 place-items-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Tutup notifikasi"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
              </div>
            </div>
            {/* Content */}
            <div className="flex-1 overflow-y-auto overscroll-contain">
              {notifications.length === 0 ? (
                <div className="px-5 py-14 text-center">
                  <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-slate-100 text-slate-400">
                    <Bell className="h-7 w-7" />
                  </span>
                  <p className="mt-4 text-base font-bold text-slate-700">Belum ada notifikasi baru</p>
                  <p className="mt-1.5 text-sm text-slate-500">Aktivitas yang dipilih akan muncul di sini.</p>
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
                        onClick={() => setNotifications((previous) => previous.map((item) => item.id === notification.id ? { ...item, read: true } : item))}
                        className={cn(
                          "flex w-full gap-3 px-5 py-4 text-left transition hover:bg-slate-50",
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
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllAsRead}
                  className="flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-xs font-bold text-indigo-600 transition hover:bg-indigo-50"
                >
                  <Check className="h-3.5 w-3.5" /> Tandai dibaca
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
                  <p className="mt-1 text-xs text-slate-500">Aktivitas yang dipilih akan muncul di sini.</p>
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
                        onClick={() => setNotifications((previous) => previous.map((item) => item.id === notification.id ? { ...item, read: true } : item))}
                        className={cn(
                          "flex w-full gap-3 px-4 py-3 text-left transition hover:bg-slate-50",
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
    </div>
  );
}
