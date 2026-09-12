"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { dashboardService, PeriodFilter, ReportingData } from "@/services/dashboardService";
import { transactionRealtimeService } from "@/services/transactionRealtimeService";
import { formatIDR } from "@/lib/utils";
import { useSettings } from "@/hooks/useSettings";
import { StatCard } from "@/components/dashboard/stat-card";
import { OverviewControls } from "@/components/dashboard/overview-controls";
import { SalesTrendChart } from "@/components/dashboard/sales-trend-chart";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  DollarSign,
  LayoutDashboard,
  Receipt,
  RefreshCw,
  ShoppingCart,
  TrendingUp,
  Users,
  XCircle,
} from "lucide-react";

function toDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function DashboardPage() {
  const { settings, isLoaded } = useSettings();
  const [data, setData] = useState<ReportingData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [liveTransactions, setLiveTransactions] = useState(0);
  const [period, setPeriod] = useState<PeriodFilter>("7days");
  const [dateRange, setDateRange] = useState(() => ({
    startDate: toDateInput(new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
    endDate: toDateInput(new Date()),
  }));
  const appliedSettings = useRef(false);

  const loadData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const result = await dashboardService.getReportingOverview(period, dateRange);
      setData(result);
      setLoadError("");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Ringkasan gagal dimuat.");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [dateRange, period]);

  useEffect(() => {
    if (!isLoaded || appliedSettings.current) return;
    appliedSettings.current = true;
    setPeriod(settings.defaultPeriod);
  }, [isLoaded, settings.defaultPeriod]);

  useEffect(() => {
    if (!isLoaded) return;
    void loadData();
    if (!settings.realtimeOn) return;

    const channel = transactionRealtimeService.subscribeTransactions((payload) => {
      if (payload.eventType === "INSERT") setLiveTransactions((current) => current + 1);
      window.setTimeout(() => void loadData(), 500);
    });
    return () => transactionRealtimeService.unsubscribe(channel);
  }, [isLoaded, loadData, settings.realtimeOn]);

  if (isLoading || !data) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-16 w-full max-w-md" />
        <Skeleton className="h-28 w-full" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-32 w-full" />)}
        </div>
      </div>
    );
  }

  const { metrics } = data;
  const successRate = metrics.totalTransactions > 0
    ? Math.round((metrics.successTransactions / metrics.totalTransactions) * 100)
    : 0;

  const statuses = [
    { label: "Berhasil", value: metrics.successTransactions, icon: CheckCircle2, style: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
    { label: "Menunggu", value: metrics.pendingTransactions, icon: Clock3, style: "bg-amber-50 text-amber-700", dot: "bg-amber-500" },
    { label: "Gagal", value: metrics.cancelledTransactions, icon: XCircle, style: "bg-rose-50 text-rose-700", dot: "bg-rose-500" },
    { label: "Hari ini", value: metrics.todayTransactions, icon: ShoppingCart, style: "bg-blue-50 text-blue-700", dot: "bg-blue-500" },
  ];

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 pb-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-bold text-indigo-600">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-indigo-50"><LayoutDashboard className="h-4 w-4" /></span>
            Ringkasan bisnis
          </div>
          <h1 className="text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">Overview Penjualan</h1>
          <p className="mt-1 text-sm text-slate-500">Pantau transaksi, omzet, dan keuntungan dari bot WhatsApp.</p>
        </div>
        <div className="flex items-center gap-2 self-start rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 sm:self-auto">
          <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" /></span>
          Realtime aktif{liveTransactions > 0 ? ` • ${liveTransactions} transaksi baru` : ""}
        </div>
      </header>

      <OverviewControls
        period={period}
        startDate={dateRange.startDate}
        endDate={dateRange.endDate}
        displayStartDate={data.startDate}
        displayEndDate={data.endDate}
        isRefreshing={isRefreshing}
        onPeriodChange={setPeriod}
        onDateChange={(field, value) => setDateRange((current) => ({ ...current, [field]: value }))}
      />

      {loadError && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          <span className="flex items-center gap-2"><AlertCircle className="h-5 w-5" />{loadError}</span>
          <button type="button" onClick={() => void loadData()} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white"><RefreshCw className="h-4 w-4" /></button>
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard title="Omzet" value={formatIDR(metrics.totalRevenue)} description="Dari transaksi berhasil" icon={DollarSign} iconColor="border-indigo-100 bg-indigo-50 text-indigo-600" />
        <StatCard title="Profit" value={formatIDR(metrics.totalProfit)} description={`Margin bersih ${metrics.averageProfitPercentage}%`} icon={TrendingUp} iconColor="border-emerald-100 bg-emerald-50 text-emerald-600" />
        <StatCard title="Transaksi" value={metrics.totalTransactions} description={`${successRate}% berhasil diproses`} icon={Receipt} iconColor="border-blue-100 bg-blue-50 text-blue-600" />
        <StatCard title="Customer" value={metrics.totalCustomers} description="Customer pada periode" icon={Users} iconColor="border-violet-100 bg-violet-50 text-violet-600" />
      </section>

      <Card className="overflow-hidden border-slate-200 bg-white shadow-sm">
        <CardContent className="p-0">
          <div className="grid grid-cols-2 divide-x divide-y divide-slate-100 sm:grid-cols-4 sm:divide-y-0">
            {statuses.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="flex items-center gap-3 p-4 sm:p-5">
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${item.style}`}><Icon className="h-4 w-4" /></span>
                  <div><p className="text-xl font-black text-slate-950">{item.value}</p><p className="flex items-center gap-1.5 text-xs font-medium text-slate-500"><span className={`h-1.5 w-1.5 rounded-full ${item.dot}`} />{item.label}</p></div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,0.8fr)]">
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between border-b border-slate-100 pb-4">
            <div>
              <CardTitle className="flex items-center gap-2 text-base font-bold text-slate-950"><Activity className="h-5 w-5 text-indigo-600" />Tren Penjualan</CardTitle>
              <CardDescription className="mt-1 text-xs">Perbandingan omzet dan profit sesuai periode</CardDescription>
            </div>
            <div className="hidden items-center gap-3 text-xs sm:flex"><span className="flex items-center gap-1.5 text-slate-500"><span className="h-2 w-2 rounded-full bg-indigo-600" />Omzet</span><span className="flex items-center gap-1.5 text-slate-500"><span className="h-2 w-2 rounded-full bg-emerald-500" />Profit</span></div>
          </CardHeader>
          <CardContent className="px-2 pb-3 pt-4 sm:px-4"><SalesTrendChart data={data.dailyData} /></CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-100 pb-4">
            <CardTitle className="flex items-center justify-between text-base font-bold text-slate-950">
              <span className="flex items-center gap-2">
                <Receipt className="h-5 w-5 text-indigo-600" />
                Transaksi Terbaru
              </span>
              <Badge variant="outline">{metrics.recentTransactions.length}</Badge>
            </CardTitle>
            <CardDescription className="mt-1 text-xs">
              Klik transaksi untuk langsung membuka dan mengubah status
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {metrics.recentTransactions.length === 0 ? (
              <div className="grid min-h-64 place-items-center p-6 text-center">
                <div>
                  <Receipt className="mx-auto h-8 w-8 text-slate-300" />
                  <p className="mt-3 text-sm font-semibold text-slate-700">Belum ada transaksi</p>
                  <p className="mt-1 text-xs text-slate-400">Coba pilih periode yang lebih panjang.</p>
                </div>
              </div>
            ) : (
              <div>
                <div className="divide-y divide-slate-100">
                  {metrics.recentTransactions.map((transaction) => (
                    <Link
                      key={transaction.id}
                      href={`/dashboard/transactions?id=${encodeURIComponent(transaction.id)}&open=true`}
                      className="group flex items-center gap-3 p-4 transition-all hover:bg-indigo-50/60 active:scale-[0.99]"
                      title="Klik untuk membuka dan mengubah status transaksi"
                    >
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-sm font-black text-slate-600 transition group-hover:bg-indigo-600 group-hover:text-white">
                        {transaction.customer_name.slice(0, 1).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-slate-900 group-hover:text-indigo-600">
                          {transaction.customer_name}
                        </p>
                        <p className="truncate text-xs text-slate-500">
                          {transaction.product_name} • {transaction.duration}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-slate-900">{formatIDR(transaction.price)}</p>
                        <StatusBadge value={transaction.status} />
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-1 group-hover:text-indigo-600" />
                    </Link>
                  ))}
                </div>
                <div className="border-t border-slate-100 bg-slate-50/60 p-3 text-center">
                  <Link
                    href="/dashboard/transactions"
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-600 transition hover:text-indigo-800"
                  >
                    <span>Buka halaman semua transaksi</span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function StatusBadge({ value }: { value: "pending" | "success" | "cancelled" }) {
  if (value === "success") return <span className="text-[11px] font-bold text-emerald-600">Berhasil</span>;
  if (value === "pending") return <span className="text-[11px] font-bold text-amber-600">Menunggu</span>;
  return <span className="text-[11px] font-bold text-rose-600">Gagal</span>;
}
