/** @type {import('next').NextConfig} */
const nextConfig = {
  // yt-dlp downloads can take a while; the job API returns immediately
  // and progress is streamed over SSE, so no special timeout config needed.
};

export default nextConfig;
