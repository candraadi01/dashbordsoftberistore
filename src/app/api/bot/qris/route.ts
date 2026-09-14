import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIMARY_QRIS_PATH = path.join(process.cwd(), "public", "uploads", "qris", "payment.jpg");
const BACKUP_QRIS_PATH = path.join(process.cwd(), "data", "payment.jpg");
const LOCAL_DB_QRIS_PATH = path.join(process.cwd(), "database", "img", "payment", "payment.jpg");
const TMP_QRIS_PATH = path.join("/tmp", "payment.jpg");
const BOT_PANEL_QRIS = path.join("D:", "BOT WHSATAPP SUPABASE", "BOT DINDA", "BOT WHATSAP PANEL DINDA", "database", "img", "payment", "payment.jpg");

function getSupabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!url || !key) return null;
  return createClient(url, key);
}

async function getActiveQrisBuffer(): Promise<{ buffer: Buffer; mimeType: string } | null> {
  // 1. Cek dari Supabase cloud jika ada base64
  const sb = getSupabaseServer();
  if (sb) {
    try {
      const { data } = await sb
        .from("bot_instances")
        .select("metadata")
        .eq("id", "bot_settings")
        .maybeSingle();

      const base64 = data?.metadata?.qrisBase64;
      if (base64 && typeof base64 === "string") {
        const clean = base64.replace(/^data:image\/\w+;base64,/, "");
        const buf = Buffer.from(clean, "base64");
        if (buf && buf.length > 0) {
          return { buffer: buf, mimeType: "image/jpeg" };
        }
      }
    } catch (_) {}
  }

  // 2. Cek dari path disk lokal
  const candidatePaths = [
    TMP_QRIS_PATH,
    PRIMARY_QRIS_PATH,
    BACKUP_QRIS_PATH,
    LOCAL_DB_QRIS_PATH,
    BOT_PANEL_QRIS,
  ];

  for (const p of candidatePaths) {
    try {
      if (fs.existsSync(p)) {
        const buffer = fs.readFileSync(p);
        if (buffer && buffer.length > 0) {
          return { buffer, mimeType: "image/jpeg" };
        }
      }
    } catch (_) {}
  }
  return null;
}

function safeWriteFile(filePath: string, buffer: Buffer) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, buffer);
  } catch (_) {}
}

export async function HEAD() {
  const active = await getActiveQrisBuffer();
  if (!active) {
    return new NextResponse(null, { status: 404 });
  }
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Content-Type": active.mimeType,
      "Content-Length": String(active.buffer.length),
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}

export async function GET() {
  const active = await getActiveQrisBuffer();
  if (!active) {
    return NextResponse.json({ error: "QRIS image not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(active.buffer), {
    status: 200,
    headers: {
      "Content-Type": active.mimeType,
      "Content-Length": String(active.buffer.length),
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      "Content-Disposition": 'inline; filename="payment.jpg"',
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    let buffer: Buffer | null = null;
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      try {
        const formData = await req.formData();
        const file = formData.get("file");
        if (file && typeof file === "object" && "arrayBuffer" in file) {
          const arrayBuffer = await (file as Blob).arrayBuffer();
          buffer = Buffer.from(arrayBuffer);
        }
      } catch (formErr) {
        console.warn("[bot/qris POST] FormData parse warning:", formErr);
      }
    }

    if (!buffer) {
      try {
        const body = await req.json().catch(() => ({}));
        const image = body.image as string | undefined;
        if (image) {
          if (image.startsWith("data:")) {
            const matches = image.match(/^data:([a-zA-Z0-9/+-]+);base64,(.+)$/);
            if (matches) {
              buffer = Buffer.from(matches[2], "base64");
            }
          } else {
            buffer = Buffer.from(image, "base64");
          }
        }
      } catch (jsonErr) {
        console.warn("[bot/qris POST] JSON parse warning:", jsonErr);
      }
    }

    if (!buffer || buffer.length === 0) {
      return NextResponse.json({ error: "No valid image data provided" }, { status: 400 });
    }

    // 1. Simpan ke Supabase metadata (agar persist di Vercel Cloud Serverless)
    const sb = getSupabaseServer();
    if (sb) {
      try {
        const { data } = await sb
          .from("bot_instances")
          .select("metadata")
          .eq("id", "bot_settings")
          .maybeSingle();

        const currentMeta = data?.metadata || {};
        await sb.from("bot_instances").upsert({
          id: "bot_settings",
          name: "Bot Settings Configuration",
          status: "online",
          version: "2.0.0",
          last_seen: new Date().toISOString(),
          metadata: {
            ...currentMeta,
            qrisBase64: `data:image/jpeg;base64,${buffer.toString("base64")}`,
            updatedAt: Date.now()
          },
          updated_at: new Date().toISOString()
        });
      } catch (sbErr) {
        console.warn("[bot/qris Supabase Sync]", sbErr);
      }
    }

    // 2. Simpan ke disk lokal jika writable (/tmp selalu writable di Vercel)
    safeWriteFile(TMP_QRIS_PATH, buffer);
    safeWriteFile(PRIMARY_QRIS_PATH, buffer);
    safeWriteFile(BACKUP_QRIS_PATH, buffer);
    safeWriteFile(LOCAL_DB_QRIS_PATH, buffer);
    safeWriteFile(BOT_PANEL_QRIS, buffer);

    return NextResponse.json({
      ok: true,
      url: `/api/bot/qris?t=${Date.now()}`,
      size: buffer.length,
    });
  } catch (err: any) {
    console.warn("[bot/qris POST]", err?.message || err);
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
