import { NextRequest } from "next/server";
import { getJob } from "@/lib/ytdlp";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      const send = (obj: unknown) =>
        controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      const tick = () => {
        const job = getJob(id);
        if (!job) {
          send({ status: "error", error: "Download expired or not found." });
          clearInterval(iv);
          controller.close();
          return;
        }
        send({
          status: job.status,
          progress: Math.round(job.progress),
          title: job.title,
          filename: job.filename,
          error: job.error,
          note: job.note,
        });
        if (job.status !== "running") {
          clearInterval(iv);
          controller.close();
        }
      };
      const iv = setInterval(tick, 600);
      tick();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
