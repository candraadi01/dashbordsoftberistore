"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, CheckCircle2, Clock3, Loader2, MessageCircle, Receipt, RefreshCw, Search, Trash2, X, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { authService } from "@/services/authService";
import { transactionRealtimeService } from "@/services/transactionRealtimeService";
import { transactionService } from "@/services/transactionService";
import { TransactionRow, TransactionStatus } from "@/types";
import { formatIDR } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const choices: Array<{ value: TransactionStatus; label: string; help: string; icon: typeof Clock3; style: string }> = [
  { value: "pending", label: "Pending", help: "Belum dijawab owner", icon: Clock3, style: "border-amber-200 bg-amber-50 text-amber-700" },
  { value: "success", label: "Berhasil", help: "Pembayaran dikonfirmasi", icon: CheckCircle2, style: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  { value: "cancelled", label: "Gagal", help: "Pesanan dibatalkan", icon: XCircle, style: "border-rose-200 bg-rose-50 text-rose-700" },
];

export default function TransactionsPage() {
  const [rows, setRows] = useState<TransactionRow[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<TransactionRow | null>(null);
  const [nextStatus, setNextStatus] = useState<TransactionStatus>("pending");
  const [modalError, setModalError] = useState("");
  const [modalSuccess, setModalSuccess] = useState("");
  const [deleting, setDeleting] = useState<TransactionRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [canEdit, setCanEdit] = useState(false);

  const load = useCallback(async () => {
    try { setRows(await transactionService.getTransactions()); setError(""); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Gagal memuat transaksi."); }
  }, []);

  useEffect(() => {
    authService.getUserRole().then((role) => setCanEdit(role === "OWNER" || role === "ADMIN"));
    void load();
    const channel = transactionRealtimeService.subscribeTransactions(() => window.setTimeout(() => void load(), 250));

    // Read search param from URL if redirected from notification
    const syncUrlQuery = () => {
      if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        const search = params.get("search") || params.get("q") || params.get("id");
        if (search) {
          setQuery(search);
        }
      }
    };
    syncUrlQuery();
    window.addEventListener("popstate", syncUrlQuery);

    return () => {
      transactionRealtimeService.unsubscribe(channel);
      window.removeEventListener("popstate", syncUrlQuery);
    };
  }, [load]);

  const shown = useMemo(() => rows.filter((row) =>
    (filter === "all" || row.status === filter) &&
    `${row.transaction_id ?? row.id} ${row.customer_name} ${row.customer_phone} ${row.product_name}`.toLowerCase().includes(query.trim().toLowerCase())
  ), [filter, query, rows]);

  function openStatus(row: TransactionRow) {
    setEditing(row);
    setNextStatus(row.status);
    setModalError("");
    setModalSuccess("");
    setError("");
  }

  async function saveStatus() {
    if (!editing) return;
    if (busy) return;
    setBusy(true); setModalError(""); setModalSuccess("");
    try {
      const saved = await transactionService.updateStatus(editing.id, nextStatus, editing.updated_at);
      setRows((current) => current.map((row) => row.id === saved.id ? saved : row));
      setModalSuccess(`Status berhasil disimpan sebagai ${statusLabel(nextStatus)}. Bot WhatsApp sedang menerima pembaruan.`);
      window.setTimeout(() => {
        setEditing(null);
        setModalSuccess("");
        void load();
      }, 1100);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Status gagal disimpan.";
      setModalError(message.includes("row-level security") ? "Akses ditolak. Pastikan akun Anda memiliki role OWNER atau ADMIN." : message);
      if (message.includes("STATUS_CONFLICT")) await load();
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try { await transactionService.deleteTransaction(deleting.id); setDeleting(null); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Transaksi gagal dihapus."); }
    finally { setBusy(false); }
  }

  return <div className="mx-auto max-w-[1500px] space-y-5 pb-8">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-bold text-indigo-600">Penjualan real-time</p><h1 className="mt-1 flex items-center gap-3 text-2xl font-black text-slate-950 sm:text-3xl"><Receipt className="text-indigo-600" />Transaksi</h1><p className="mt-1 text-sm text-slate-500">Status dashboard dan balasan owner di WhatsApp selalu disinkronkan.</p></div><Button variant="outline" onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" />Segarkan</Button></header>

    <Card><CardContent className="grid gap-3 p-4 sm:grid-cols-[1fr_190px]"><div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input className="h-10 w-full rounded-xl border border-slate-200 pl-10 pr-3 text-sm outline-none focus:border-indigo-400" placeholder="Cari ID, customer, WhatsApp, atau produk" value={query} onChange={(event) => setQuery(event.target.value)} /></div><select className="h-10 rounded-xl border border-slate-200 px-3 text-sm" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">Semua status</option><option value="pending">Pending</option><option value="success">Berhasil</option><option value="cancelled">Gagal</option></select></CardContent></Card>
    {error && <div className="flex items-start gap-2 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

    <div className="space-y-3 md:hidden">{shown.map((row) => <article key={row.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="font-mono text-[10px] text-slate-400">{row.transaction_id ?? row.id.slice(0, 8)}</p><h2 className="mt-1 truncate font-black text-slate-950">{row.customer_name}</h2><p className="text-xs text-slate-500">{row.customer_phone.replace("@lid", "")}</p></div><Status value={row.status} /></div><div className="my-4 rounded-xl bg-slate-50 p-3"><p className="font-bold text-slate-900">{row.product_name}</p><p className="text-xs text-slate-500">{row.category} • {row.duration}</p></div><div className="grid grid-cols-2 gap-2"><div><p className="text-[10px] font-semibold text-slate-400">TOTAL</p><p className="font-black text-slate-950">{formatIDR(row.price)}</p></div><div><p className="text-[10px] font-semibold text-slate-400">PROFIT</p><p className="font-black text-emerald-600">{formatIDR(row.profit_amount)}</p></div></div><SyncNote row={row} />{canEdit && <div className="mt-4 grid grid-cols-[1fr_44px] gap-2"><Button variant="outline" onClick={() => openStatus(row)} className="h-11"><RefreshCw className="mr-2 h-4 w-4" />Ubah status</Button><Button variant="outline" onClick={() => setDeleting(row)} className="h-11 border-rose-200 text-rose-600"><Trash2 className="h-4 w-4" /></Button></div>}</article>)}</div>

    <Card className="hidden overflow-hidden md:block"><CardContent className="overflow-x-auto p-0"><table className="w-full min-w-[960px] text-left text-sm"><thead className="bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-4">Transaksi</th><th className="px-5 py-4">Customer</th><th className="px-5 py-4">Produk</th><th className="px-5 py-4">Nilai</th><th className="px-5 py-4">Profit</th><th className="px-5 py-4">Status & Sinkron</th><th className="px-5 py-4">Waktu</th>{canEdit && <th className="px-5 py-4 text-right">Aksi</th>}</tr></thead><tbody className="divide-y divide-slate-100">{shown.map((row) => <tr key={row.id} className="hover:bg-slate-50"><td className="px-5 py-4 font-mono text-xs text-slate-500">{row.transaction_id ?? row.id.slice(0, 8)}</td><td className="px-5 py-4"><b className="block text-slate-900">{row.customer_name}</b><span className="text-xs text-slate-500">{row.customer_phone.replace("@lid", "")}</span></td><td className="px-5 py-4"><b className="block text-slate-800">{row.product_name}</b><span className="text-xs text-slate-500">{row.category} • {row.duration}</span></td><td className="px-5 py-4 font-semibold">{formatIDR(row.price)}</td><td className="px-5 py-4 font-semibold text-emerald-600">{formatIDR(row.profit_amount)}</td><td className="px-5 py-4"><Status value={row.status} /><SyncNote row={row} /></td><td className="px-5 py-4 text-xs text-slate-500">{new Date(row.created_at).toLocaleString("id-ID")}</td>{canEdit && <td className="px-5 py-4"><div className="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => openStatus(row)}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Status</Button><Button size="icon" variant="ghost" className="text-rose-600" onClick={() => setDeleting(row)}><Trash2 className="h-4 w-4" /></Button></div></td>}</tr>)}</tbody></table>{shown.length === 0 && <p className="p-10 text-center text-sm text-slate-500">Tidak ada transaksi yang cocok.</p>}</CardContent></Card>

    <AnimatePresence>{editing && <motion.div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/45 backdrop-blur-sm sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><motion.div initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }} className="max-h-[94dvh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:max-w-lg sm:rounded-3xl"><div className="flex items-start justify-between"><div><p className="text-xs font-bold uppercase text-indigo-600">Proses transaksi</p><h2 className="mt-1 text-xl font-black text-slate-950">Pilih status</h2><p className="text-xs text-slate-500">{editing.transaction_id ?? editing.id}</p></div><button type="button" disabled={busy || Boolean(modalSuccess)} onClick={() => setEditing(null)} className="grid h-11 w-11 place-items-center rounded-xl hover:bg-slate-100 disabled:opacity-40"><X /></button></div><div className="mt-5 space-y-2">{choices.map((item) => { const Icon=item.icon; const isCurrent=item.value === editing.status; return <button key={item.value} disabled={busy || Boolean(modalSuccess)} type="button" onClick={() => { setNextStatus(item.value); setModalError(""); }} className={`flex min-h-16 w-full items-center gap-3 rounded-2xl border p-3 text-left transition active:scale-[.98] disabled:cursor-wait ${item.style} ${nextStatus === item.value ? "ring-2 ring-indigo-300" : "opacity-75"}`}><Icon className="h-5 w-5" /><span><span className="flex items-center gap-2 text-sm font-black">{item.label}{isCurrent && <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-bold">Saat ini</span>}</span><span className="block text-xs opacity-75">{item.help}</span></span>{nextStatus === item.value && <CheckCircle2 className="ml-auto h-5 w-5" />}</button> })}</div><p className="mt-4 flex items-start gap-2 rounded-xl bg-blue-50 p-3 text-xs text-blue-700"><MessageCircle className="mt-0.5 h-4 w-4 shrink-0" />Status disimpan langsung ke database. Bot akan menerima pembaruan secara real-time atau melalui pemeriksaan cadangan maksimal sekitar 8 detik.</p>{modalError && <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{modalError}</motion.p>}{modalSuccess && <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-3 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-700"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{modalSuccess}</motion.p>}<Button onClick={saveStatus} disabled={busy || Boolean(modalSuccess)} className="mt-4 h-12 w-full bg-indigo-600 text-white hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-70">{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}{busy ? "Menyimpan ke database..." : nextStatus === editing.status ? "Kirim ulang status ke WhatsApp" : "Simpan dan sinkronkan"}</Button></motion.div></motion.div>}</AnimatePresence>

    <AnimatePresence>{deleting && <motion.div className="fixed inset-0 z-[110] flex items-end justify-center bg-slate-950/45 backdrop-blur-sm sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><motion.div initial={{ scale: .94, y: 50 }} animate={{ scale: 1, y: 0 }} exit={{ scale: .94, y: 50 }} className="w-full rounded-t-3xl bg-white p-5 text-center shadow-2xl sm:max-w-sm sm:rounded-3xl"><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-rose-100 text-rose-600"><Trash2 /></span><h2 className="mt-4 text-lg font-black text-slate-950">Hapus transaksi?</h2><p className="mt-1 text-sm text-slate-500">{deleting.transaction_id ?? deleting.id}</p><div className="mt-5 grid grid-cols-2 gap-2"><Button variant="outline" onClick={() => setDeleting(null)} disabled={busy}>Batal</Button><Button variant="destructive" onClick={remove} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Hapus"}</Button></div></motion.div></motion.div>}</AnimatePresence>
  </div>;
}

function Status({ value }: { value: TransactionStatus }) { const style=value === "success" ? "bg-emerald-50 text-emerald-700" : value === "pending" ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700"; return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${style}`}>{value === "success" ? "Berhasil" : value === "pending" ? "Pending" : "Gagal"}</span>; }
function statusLabel(value: TransactionStatus) { return value === "success" ? "Berhasil" : value === "pending" ? "Pending" : "Gagal"; }
function SyncNote({ row }: { row: TransactionRow }) { if (row.status_source !== "dashboard") return null; const pending=row.status_sync_state === "pending"; return <p className={`mt-1 flex items-center gap-1 text-[10px] font-semibold ${pending ? "text-amber-600" : "text-emerald-600"}`}>{pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}{pending ? "Menunggu bot WhatsApp" : "WhatsApp tersinkron"}</p>; }
