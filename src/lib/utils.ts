import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { NextRequest } from "next/server";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Returns the public-facing base URL for an incoming request.
 * Uses X-Forwarded-Host + X-Forwarded-Proto headers (set by ngrok in
 * dev and by Vercel in prod) when present, falling back to req.url
 * otherwise. Prevents OAuth redirects from landing on localhost when
 * the dev server is accessed via a proxy.
 */
export function getPublicBaseUrl(req: NextRequest): URL {
  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto") ?? "https";
  if (forwardedHost) {
    return new URL(`${forwardedProto}://${forwardedHost}`);
  }
  return new URL(req.url);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function pickGradient(seed: string): string {
  const palette = [
    "from-purple-500 to-pink-500",
    "from-cyan-400 to-blue-500",
    "from-orange-400 to-red-500",
    "from-emerald-400 to-teal-500",
    "from-violet-500 to-purple-500",
    "from-pink-500 to-orange-500",
    "from-violet-400 to-fuchsia-500",
    "from-sky-400 to-cyan-500",
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[h % palette.length]!;
}
