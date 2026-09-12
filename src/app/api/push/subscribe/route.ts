import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Supabase admin client (server-side only)
function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY belum diisi di .env.local");
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

// GET: cek apakah endpoint ini sudah terdaftar
export async function GET(req: NextRequest) {
  const endpoint = req.nextUrl.searchParams.get("endpoint");
  if (!endpoint) return NextResponse.json({ subscribed: false });
  const admin = getAdminClient();
  const { data } = await admin
    .from("push_subscriptions")
    .select("id")
    .eq("endpoint", endpoint)
    .maybeSingle();
  return NextResponse.json({ subscribed: Boolean(data) });
}

// POST: simpan subscription baru
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { endpoint, keys, expirationTime } = body as {
      endpoint: string;
      keys: { p256dh: string; auth: string };
      expirationTime?: number | null;
    };

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return NextResponse.json({ error: "Data subscription tidak lengkap" }, { status: 400 });
    }

    // Ambil user dari Authorization header (Supabase JWT)
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();

    let userId: string | null = null;
    if (token) {
      const anonClient = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      const { data: userData } = await anonClient.auth.getUser(token);
      userId = userData?.user?.id ?? null;
    }

    const admin = getAdminClient();
    const userAgent = req.headers.get("user-agent") ?? null;

    // Upsert — kalau endpoint sudah ada, update. Kalau baru, insert.
    const { error } = await admin.from("push_subscriptions").upsert(
      {
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        user_id: userId,
        user_agent: userAgent,
        expires_at: expirationTime ? new Date(expirationTime).toISOString() : null,
      },
      { onConflict: "endpoint" }
    );

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[push/subscribe POST]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// DELETE: hapus subscription (unsubscribe)
export async function DELETE(req: NextRequest) {
  try {
    const { endpoint } = await req.json();
    if (!endpoint) return NextResponse.json({ error: "endpoint wajib diisi" }, { status: 400 });

    const admin = getAdminClient();
    const { error } = await admin.from("push_subscriptions").delete().eq("endpoint", endpoint);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[push/subscribe DELETE]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
