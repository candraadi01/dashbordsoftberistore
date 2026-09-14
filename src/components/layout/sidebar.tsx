"use client";

import React, { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authService } from "@/services/authService";
import { UserRole } from "@/types";
import {
  Activity,
  MessageSquareText,
  LayoutDashboard,
  LogOut,
  Package,
  PieChart,
  Receipt,
  Settings,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const dashboardNavigation = [
  { name: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { name: "Customers CRM", href: "/dashboard/customers", icon: Users },
  { name: "Transactions", href: "/dashboard/transactions", icon: Receipt },
  { name: "Products", href: "/dashboard/products", icon: Package },
  { name: "Pesan Bot & QRIS", href: "/dashboard/finance", icon: MessageSquareText },
  { name: "Reports", href: "/dashboard/reports", icon: PieChart },
  { name: "Monitoring", href: "/dashboard/monitoring", icon: Activity },
  { name: "Settings", href: "/dashboard/settings", icon: Settings },
];

export function getVisibleNavigation(role: UserRole | null) {
  return dashboardNavigation.filter((item) => {
    if (
      role === "STAFF" &&
      ["Reports", "Settings", "Pesan Bot & QRIS", "Products"].includes(item.name)
    ) {
      return false;
    }
    return true;
  });
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("flex items-center gap-3", compact ? "px-1" : "px-2 py-3")}>
      <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-2xl bg-indigo-50 shadow-sm ring-1 ring-indigo-100">
        <Image
          src="/brand/softberystore-logo.png"
          alt="Logo SoftberyStore"
          fill
          sizes="44px"
          className="object-contain p-1"
          priority
        />
      </div>
      <div className="min-w-0">
        <h2 className="truncate text-sm font-black tracking-tight text-slate-950">
          SoftberyStore
        </h2>
        <p className="text-xs font-medium text-slate-500">Admin Dashboard</p>
      </div>
    </div>
  );
}

function NavigationLinks({
  role,
  onNavigate,
  mobile = false,
}: {
  role: UserRole | null;
  onNavigate?: () => void;
  mobile?: boolean;
}) {
  const pathname = usePathname();

  return (
    <nav className="space-y-1.5" aria-label="Navigasi dashboard">
      {getVisibleNavigation(role).map((item) => {
        const isActive =
          pathname === item.href ||
          (item.href !== "/dashboard" && pathname.startsWith(item.href));
        const Icon = item.icon;

        return (
          <Link
            key={item.name}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "group flex items-center gap-3 rounded-xl font-semibold transition-all duration-200",
              mobile ? "min-h-12 px-4 py-3 text-sm" : "px-3 py-2.5 text-xs",
              isActive
                ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
            )}
            aria-current={isActive ? "page" : undefined}
          >
            <span
              className={cn(
                "grid shrink-0 place-items-center rounded-lg transition-colors",
                mobile ? "h-8 w-8" : "h-7 w-7",
                isActive
                  ? "bg-white/15 text-white"
                  : "bg-slate-100 text-slate-500 group-hover:bg-white group-hover:text-indigo-600"
              )}
            >
              <Icon className={mobile ? "h-[18px] w-[18px]" : "h-4 w-4"} />
            </span>
            <span>{item.name}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function ConnectionStatus() {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs">
      <p className="font-bold text-slate-700">Database Realtime</p>
      <p className="mt-1 flex items-center gap-2 font-semibold text-emerald-600">
        <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,.12)]" />
        Connected
      </p>
    </div>
  );
}

export function Sidebar() {
  const router = useRouter();
  const [userRole, setUserRole] = useState<UserRole | null>(null);

  useEffect(() => {
    authService.getUserRole().then(setUserRole);
  }, []);

  const handleLogout = async () => {
    await authService.signOut();
    router.push("/login");
  };

  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col justify-between border-r border-slate-200/80 bg-white/95 p-4 backdrop-blur-xl md:flex">
      <div className="space-y-5">
        <div className="border-b border-slate-200 pb-4">
          <Brand />
        </div>
        <NavigationLinks role={userRole} />
      </div>

      <div className="space-y-3">
        <button
          onClick={handleLogout}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white p-2 text-sm font-semibold text-slate-600 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
        >
          <LogOut className="h-4 w-4" />
          Logout
        </button>
        <ConnectionStatus />
      </div>
    </aside>
  );
}

export function MobileSidebar({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);

  useEffect(() => {
    authService.getUserRole().then(setUserRole);
  }, []);

  useEffect(() => {
    onClose();
  }, [pathname, onClose]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, onClose]);

  const handleLogout = async () => {
    onClose();
    await authService.signOut();
    router.push("/login");
  };

  return (
    <div
      className={cn(
        "fixed inset-0 z-[70] md:hidden",
        open ? "pointer-events-auto" : "pointer-events-none"
      )}
      aria-hidden={!open}
    >
      <button
        type="button"
        aria-label="Tutup menu"
        onClick={onClose}
        className={cn(
          "absolute inset-0 bg-slate-950/45 backdrop-blur-[2px] transition-opacity duration-300",
          open ? "opacity-100" : "opacity-0"
        )}
        tabIndex={open ? 0 : -1}
      />

      <aside
        inert={!open}
        className={cn(
          "absolute inset-y-0 left-0 flex w-[min(86vw,320px)] flex-col bg-white shadow-2xl transition-transform duration-300 ease-out",
          open ? "translate-x-0" : "-translate-x-full"
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Menu utama"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <Brand compact />
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600 transition hover:bg-slate-200 hover:text-slate-950"
            aria-label="Tutup sidebar"
            tabIndex={open ? 0 : -1}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-5">
          <p className="mb-3 px-2 text-xs font-black uppercase tracking-[0.16em] text-slate-400">
            Menu utama
          </p>
          <NavigationLinks role={userRole} onNavigate={onClose} mobile />
        </div>

        <div className="space-y-3 border-t border-slate-200 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
          <ConnectionStatus />
          <button
            onClick={handleLogout}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 text-sm font-bold text-red-600 transition active:scale-[.98]"
            tabIndex={open ? 0 : -1}
          >
            <LogOut className="h-4 w-4" />
            Keluar dari dashboard
          </button>
        </div>
      </aside>
    </div>
  );
}
