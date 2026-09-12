import { NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

// Konfigurasi VAPID sekali saja
webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || "mailto:admin@softberystore.com",
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY belum diisi");
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

function statusLabel(status: string) {
  if (status === "success") return "Berhasil ✅";
  if (status === "cancelled") return "Dibatalkan ❌";
  return "Menunggu konfirmasi ⏳";
}

// POST: dipanggil oleh Supabase Database Webhook saat ada INSERT/UPDATE di tabel transactions
export async function POST(req: NextRequest) {
  try {
    // ── 1. Verifikasi webhook secret ────────────────────────────────────────
    const secret = process.env.PUSH_WEBHOOK_SECRET;
    if (secret) {
      const incoming = req.headers.get("x-webhook-secret") || req.headers.get("authorization")?.replace("Bearer ", "") || "";
      if (incoming !== secret) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    // ── 2. Parse payload dari Supabase Webhook ──────────────────────────────
    const body = await req.json();

    // Supabase Webhook format: { type, table, record, old_record, schema }
    // Tapi kita juga support format manual { title, body, url, tag }
    let title = "SoftberyStore";
    let message = "Ada aktivitas baru di toko Anda";
    let url = "/dashboard/transactions";
    let tag = "softbery-txn";

    if (body.table === "transactions" || body.record) {
      const record = body.record || body.new;
      const oldRecord = body.old_record || body.old;
      const eventType = body.type || (body.eventType as string) || "INSERT";

      if (record) {
        const customer = record.customer_name || "Customer";
        const product = record.product_name || "Produk";
        const txId = record.transaction_id || record.id?.slice(0, 8)?.toUpperCase() || "";
        const status = record.status || "pending";

        if (eventType === "INSERT") {
          title = "🛒 Transaksi Baru!";
          message = `${customer} memesan ${product}`;
          if (txId) message += ` · #${txId}`;
        } else if (eventType === "UPDATE") {
          const oldStatus = oldRecord?.status;
          if (oldStatus && oldStatus !== status) {
            title = "📋 Status Diperbarui";
            message = `#${txId} ${customer} → ${statusLabel(status)}`;
          } else {
            // Status tidak berubah → skip push
            return NextResponse.json({ ok: true, skipped: true, reason: "status_unchanged" });
          }
        }

        url = `/dashboard/transactions?id=${encodeURIComponent(record.id)}&open=true`;
        tag = `softbery-txn-${record.id}`;
      }
    } else if (body.title) {
      // Format manual: { title, body, url }
      title = body.title;
      message = body.body || message;
      url = body.url || url;
      tag = body.tag || tag;
    }

    // ── 3. Ambil semua subscriber dari database ─────────────────────────────
    const admin = getAdminClient();
    const { data: subscribers, error: fetchError } = await admin
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .limit(500);

    if (fetchError) throw fetchError;
    if (!subscribers || subscribers.length === 0) {
      return NextResponse.json({ ok: true, sent: 0, message: "Tidak ada subscriber" });
    }

    // ── 4. Kirim push ke semua subscriber ──────────────────────────────────
    const payload = JSON.stringify({ title, body: message, url, tag });
    const staleEndpoints: string[] = [];

    const results = await Promise.allSettled(
      subscribers.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
            { TTL: 60 * 60 * 24 } // 24 jam TTL
          );
        } catch (err: unknown) {
          // Jika subscription kadaluarsa / tidak valid → hapus dari DB
          const statusCode = (err as { statusCode?: number })?.statusCode;
          if (statusCode === 410 || statusCode === 404) {
            staleEndpoints.push(sub.endpoint);
          } else {
            throw err;
          }
        }
      })
    );

    // Hapus subscription yang sudah tidak valid
    if (staleEndpoints.length > 0) {
      await admin.from("push_subscriptions").delete().in("endpoint", staleEndpoints);
    }

    const sent = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    console.log(`[push/send] Sent: ${sent}, Failed: ${failed}, Stale removed: ${staleEndpoints.length}`);
    return NextResponse.json({ ok: true, sent, failed, stale: staleEndpoints.length });
  } catch (err) {
    console.error("[push/send POST]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
