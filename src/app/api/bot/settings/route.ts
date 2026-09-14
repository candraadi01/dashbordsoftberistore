import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA_DIR = path.join(process.cwd(), "data");
const SETTINGS_FILE = path.join(DATA_DIR, "bot_settings.json");
const BOT_PANEL_SETTINGS = path.join("D:", "BOT WHSATAPP SUPABASE", "BOT DINDA", "BOT WHATSAP PANEL DINDA", "database", "bot_settings.json");

export interface BotSettings {
  statusMessages: {
    pending: string;
    success: string;
    cancelled: string;
  };
  payment: {
    greetingTemplate: string;
    dana: string;
    bri: string;
    ewallet: string;
    accountName: string;
    footerNotes: string;
    qrisImageUrl: string;
  };
  updatedAt?: number;
}

const defaultBotSettings: BotSettings = {
  statusMessages: {
    pending: "Halo, Pesanan kamu dengan ID *{id}* untuk produk *{product}* Kategori *{category}* saat ini berstatus *PENDING*. Mohon menunggu konfirmasi admin ya!",
    success: "Halo, Pesanan kamu dengan ID *{id}* untuk produk *{product}* Kategori *{category}* saat ini berstatus *BERHASIL*. Terima kasih telah berbelanja!",
    cancelled: "Pesanan Anda dibatalkan. Silakan hubungi admin jika memerlukan bantuan.",
  },
  payment: {
    greetingTemplate: "Hello Kak *{customer}* 👋\n\nTotalnya menjadi: *{total}*{discount}\nSilakan transfer ke salah satu metode pembayaran berikut:",
    dana: "085737453120",
    bri: "614101027583536",
    ewallet: "085737453120",
    accountName: "DNH",
    footerNotes: "• ShopeePay: 085737453120 (dndahiday13_)\n• OVO: 085785040148 (M)\n• GoPay: 085785040148 (M/DNH)\n\n🔔 Setelah transfer, kirimkan bukti pembayaran di chat ini untuk aktivasi paket. Terima kasih!",
    qrisImageUrl: "/api/bot/qris",
  },
  updatedAt: Date.now(),
};

function getSupabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!url || !key) return null;
  return createClient(url, key);
}

async function fetchBotSettings(): Promise<BotSettings> {
  const sb = getSupabaseServer();
  if (sb) {
    try {
      const { data, error } = await sb
        .from("bot_instances")
        .select("metadata")
        .eq("id", "bot_settings")
        .maybeSingle();

      if (data && data.metadata && (data.metadata as any).statusMessages) {
        return {
          ...defaultBotSettings,
          ...(data.metadata as any),
        };
      }
    } catch (sbErr) {
      console.warn("[bot/settings fetch Supabase]", sbErr);
    }
  }

  // Fallback: baca dari file lokal jika ada
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
      return { ...defaultBotSettings, ...JSON.parse(raw) };
    }
  } catch (_) {}

  return defaultBotSettings;
}

function syncToFile(filePath: string, content: string) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, "utf-8");
  } catch (_) {}
}

export async function GET() {
  const settings = await fetchBotSettings();
  return NextResponse.json({ ok: true, success: true, settings, data: settings });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const current = await fetchBotSettings();

    const updated: BotSettings = {
      statusMessages: {
        pending: typeof body.statusMessages?.pending === "string" ? body.statusMessages.pending : current.statusMessages.pending,
        success: typeof body.statusMessages?.success === "string" ? body.statusMessages.success : current.statusMessages.success,
        cancelled: typeof body.statusMessages?.cancelled === "string" ? body.statusMessages.cancelled : current.statusMessages.cancelled,
      },
      payment: {
        greetingTemplate: typeof body.payment?.greetingTemplate === "string" ? body.payment.greetingTemplate : current.payment.greetingTemplate,
        dana: typeof body.payment?.dana === "string" ? body.payment.dana : current.payment.dana,
        bri: typeof body.payment?.bri === "string" ? body.payment.bri : current.payment.bri,
        ewallet: typeof body.payment?.ewallet === "string" ? body.payment.ewallet : current.payment.ewallet,
        accountName: typeof body.payment?.accountName === "string" ? body.payment.accountName : current.payment.accountName,
        footerNotes: typeof body.payment?.footerNotes === "string" ? body.payment.footerNotes : current.payment.footerNotes,
        qrisImageUrl: current.payment.qrisImageUrl,
      },
      updatedAt: Date.now(),
    };

    // 1. Simpan ke Supabase sebagai sumber data utama (Cloud / Vercel Serverless Ready)
    const sb = getSupabaseServer();
    if (sb) {
      try {
        const { error: sbError } = await sb.from("bot_instances").upsert({
          id: "bot_settings",
          name: "Bot Settings Configuration",
          status: "online",
          version: "2.0.0",
          last_seen: new Date().toISOString(),
          metadata: updated as any,
          updated_at: new Date().toISOString()
        });
        if (sbError) {
          console.warn("[bot/settings Supabase Upsert]", sbError.message);
        }
      } catch (sbEx) {
        console.warn("[bot/settings Supabase Exception]", sbEx);
      }
    }

    // 2. Coba simpan ke file lokal (aman dari error EROFS di Vercel)
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const jsonStr = JSON.stringify(updated, null, 2);
      fs.writeFileSync(SETTINGS_FILE, jsonStr, "utf-8");
      syncToFile(path.join(process.cwd(), "database", "bot_settings.json"), jsonStr);
      syncToFile(BOT_PANEL_SETTINGS, jsonStr);
    } catch (_) {
      // Abaikan error file system read-only di serverless hosting seperti Vercel
    }

    return NextResponse.json({ ok: true, success: true, settings: updated, data: updated });
  } catch (err: any) {
    console.warn("[bot/settings POST]", err?.message || err);
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
