import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { getJob } from "@/lib/ytdlp";

function sanitize(name: string): string {
  const clean = name
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/["\\/:*?<>|]+/g, "_")
    .trim()
    .slice(0, 120);
  return clean || "video.mp4";
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = getJob(id);
  if (!job || job.status !== "done" || !job.filepath) {
    return NextResponse.json(
      { ok: false, error: "File is not ready yet." },
      { status: 404 }
    );
  }
  const stat = await fs.stat(job.filepath).catch(() => null);
  if (!stat) {
    return NextResponse.json(
      { ok: false, error: "File expired. Please download again." },
      { status: 410 }
    );
  }
  const webStream = Readable.toWeb(createReadStream(job.filepath));
  const filename = sanitize(job.filename || "video.mp4");
  return new Response(webStream as unknown as BodyInit, {
    headers: {
      "Content-Type": job.quality === "audio" ? "audio/mpeg" : "video/mp4",
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
