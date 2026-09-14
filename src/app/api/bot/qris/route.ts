import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIMARY_QRIS_PATH = path.join(process.cwd(), "public", "uploads", "qris", "payment.jpg");
const BACKUP_QRIS_PATH = path.join(process.cwd(), "data", "payment.jpg");
const LOCAL_DB_QRIS_PATH = path.join(process.cwd(), "database", "img", "payment", "payment.jpg");
const BOT_PANEL_QRIS = path.join("D:", "BOT WHSATAPP SUPABASE", "BOT DINDA", "BOT WHATSAP PANEL DINDA", "database", "img", "payment", "payment.jpg");

function getActiveQrisBuffer(): { buffer: Buffer; mimeType: string } | null {
  const candidatePaths = [
    PRIMARY_QRIS_PATH,
    BACKUP_QRIS_PATH,
    LOCAL_DB_QRIS_PATH,
    BOT_PANEL_QRIS,
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      try {
        const buffer = fs.readFileSync(p);
        if (buffer && buffer.length > 0) {
          return { buffer, mimeType: "image/jpeg" };
        }
      } catch (_) {}
    }
  }
  return null;
}

function saveBufferToAll(buffer: Buffer) {
  const targetPaths = [
    PRIMARY_QRIS_PATH,
    BACKUP_QRIS_PATH,
    LOCAL_DB_QRIS_PATH,
    BOT_PANEL_QRIS,
  ];

  for (const target of targetPaths) {
    try {
      const dir = path.dirname(target);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(target, buffer);
    } catch (_) {}
  }
}

export async function HEAD() {
  const active = getActiveQrisBuffer();
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
  const active = getActiveQrisBuffer();
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

    saveBufferToAll(buffer);

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
