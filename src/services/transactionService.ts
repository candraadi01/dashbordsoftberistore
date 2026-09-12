import { supabase } from "@/lib/supabase";
import { TransactionRow, TransactionStatus, TransactionUpdate } from "@/types";
import { transactionRealtimeService } from "@/services/transactionRealtimeService";

function statusErrorMessage(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("status_conflict")) return "Transaksi baru saja berubah. Data sudah dimuat ulang; silakan pilih status lagi.";
  if (normalized.includes("akses ditolak") || normalized.includes("permission denied") || normalized.includes("row-level security")) return "Akses ditolak. Pastikan akun dashboard memiliki role OWNER atau ADMIN.";
  if (normalized.includes("could not find the function") || normalized.includes("schema cache")) return "Fungsi sinkronisasi Supabase belum diperbarui. Jalankan file supabase/CRITICAL-FIX-STATUS-DELETE.sql satu kali.";
  return message;
}

export const transactionService = {
  async getTransactions(): Promise<TransactionRow[]> { const { data, error } = await supabase.from("transactions").select("*").order("created_at", { ascending: false }); if (error) throw new Error(error.message); return data ?? []; },
  async getTransactionById(id: string) { const { data, error } = await supabase.from("transactions").select("*").eq("id", id).maybeSingle(); if (error) throw new Error(error.message); return data; },
  async updateTransaction(id: string, updates: TransactionUpdate) { const next = { ...updates }; if (next.price !== undefined && next.profit_amount !== undefined) next.profit_percentage = next.price > 0 ? Number(((next.profit_amount / next.price) * 100).toFixed(2)) : 0; const { data, error } = await supabase.from("transactions").update(next).eq("id", id).select().single(); if (error) throw new Error(error.message); return data; },
  async updateStatus(id: string, status: TransactionStatus, expectedUpdatedAt: string) {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !sessionData.session) throw new Error("Sesi login berakhir. Silakan login kembali.");

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    try {
      const { data, error } = await supabase.rpc("dashboard_set_transaction_status", {
        p_transaction_id: id,
        p_status: status,
        p_expected_updated_at: expectedUpdatedAt,
      }).abortSignal(controller.signal);

      if (error) throw new Error(statusErrorMessage(error.message));
      const saved = (Array.isArray(data) ? data[0] : data) as TransactionRow | null;
      if (!saved?.id) throw new Error("Supabase tidak mengembalikan transaksi yang diperbarui. Jalankan file SQL hotfix lalu coba lagi.");
      transactionRealtimeService.notifyLocalChange(saved, "UPDATE");
      return saved;
    } catch (caught) {
      if (caught instanceof Error && caught.name === "AbortError") {
        throw new Error("Koneksi ke Supabase terlalu lama. Periksa internet lalu coba kembali.");
      }
      if (caught instanceof Error) throw new Error(statusErrorMessage(caught.message));
      throw new Error("Status transaksi gagal disimpan.");
    } finally {
      window.clearTimeout(timeout);
    }
  },
  async deleteTransaction(id: string) {
    const { data, error } = await supabase.from("transactions").delete().eq("id", id).select("id").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Transaksi tidak ditemukan atau akun tidak memiliki izin menghapus.");
  }
};
