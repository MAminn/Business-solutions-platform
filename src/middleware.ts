import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/meta/oauth/callback",
  "/api/cron/purge-meta-oauth-sessions",
  "/api/cron/sync-all",
  "/api/cron/rotate-tokens",
]);

const isClerkConfigured = Boolean(
  process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
);

// If Clerk isn't configured (local dev / preview), bypass auth entirely.
// NEVER deploy to production without setting Clerk env vars.
const passthrough = (_req: NextRequest) => NextResponse.next();

export default isClerkConfigured
  ? clerkMiddleware((auth, req) => {
      if (!isPublicRoute(req)) auth().protect();
    })
  : passthrough;

export const config = {
  matcher: [
    // Skip Next internals and static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?:on)?|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
