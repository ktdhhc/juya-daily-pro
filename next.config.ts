import type { NextConfig } from "next";

const WORKER_ORIGIN =
  process.env.NEXT_PUBLIC_WORKER_ORIGIN ?? "http://localhost:8787";

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  // dev 模式下把 /api/* 代理到本地 wrangler dev (默认 :8787)，
  // 避免 CORS 折腾、保持单页面源（同源 fetch）。
  // 静态导出（生产）下 rewrites 仅作用于 dev server，不影响 out/ 产物。
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${WORKER_ORIGIN}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;