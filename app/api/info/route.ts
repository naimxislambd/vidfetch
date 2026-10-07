import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { validateUrl, getVideoInfo, writeCookies } from "@/lib/ytdlp";

export async function POST(req: NextRequest) {
  let cookieFile: string | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    const url = validateUrl(body?.url);
    if (typeof body?.cookies === "string" && body.cookies.trim()) {
      cookieFile = await writeCookies(body.cookies);
    }
    const info = await getVideoInfo(url, cookieFile);
    return NextResponse.json({ ok: true, info });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to fetch video info." },
      { status: 400 }
    );
  } finally {
    if (cookieFile) await fs.unlink(cookieFile).catch(() => {});
  }
}
