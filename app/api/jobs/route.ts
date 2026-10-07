import { NextRequest, NextResponse } from "next/server";
import {
  validateUrl,
  createJob,
  siteCookiesFor,
  type QualityKey,
} from "@/lib/ytdlp";

const QUALITIES: QualityKey[] = ["best", "q1080", "q720", "q480", "audio"];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const url = validateUrl(body?.url);
    const quality: QualityKey = QUALITIES.includes(body?.quality)
      ? body.quality
      : "best";
    const cookies = siteCookiesFor(
      url,
      typeof body?.cookies === "string" ? body.cookies : undefined
    );
    const job = createJob(url, quality, cookies);
    return NextResponse.json({ ok: true, jobId: job.id });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed to start download." },
      { status: 400 }
    );
  }
}
