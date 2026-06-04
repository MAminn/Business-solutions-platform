/**
 * Auth helpers.
 *
 * In production this uses Clerk. In local development, if Clerk env vars
 * are missing, we fall back to a deterministic "demo user" so the app
 * boots up immediately after seeding. Never deploy without Clerk keys.
 */

import {
  auth as clerkAuth,
  currentUser as clerkCurrentUser,
} from "@clerk/nextjs/server";
import { db } from "./db";
import { Prisma } from "@prisma/client";
import type { User, UserRole } from "@prisma/client";

export function isClerkConfigured(): boolean {
  return Boolean(
    process.env.CLERK_SECRET_KEY &&
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  );
}

/**
 * Returns the current authenticated DB user. In dev fallback mode, returns
 * the first OWNER user from the seed.
 */
export async function getCurrentUser(): Promise<User | null> {
  if (!isClerkConfigured()) {
    return db.user.findFirst({ where: { role: "OWNER" } });
  }
  const { userId } = clerkAuth();
  if (!userId) return null;

  let user = await db.user.findUnique({ where: { clerkId: userId } });
  if (!user) {
    const cu = await clerkCurrentUser();
    if (!cu) return null;
    const email = cu.emailAddresses[0]?.emailAddress ?? `${userId}@unknown`;
    try {
      user = await db.user.create({
        data: {
          clerkId: userId,
          email,
          name: [cu.firstName, cu.lastName].filter(Boolean).join(" ") || null,
          avatarUrl: cu.imageUrl,
          role: "TEAM",
        },
      });
    } catch (err) {
      // A concurrent request may have created this user first. Treat the
      // unique-constraint violation on clerkId as a benign race and return
      // the existing record.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        return db.user.findUnique({ where: { clerkId: userId } });
      }
      throw err;
    }
  }
  return user;
}

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  return user;
}

export function hasRole(user: User, ...roles: UserRole[]): boolean {
  return roles.includes(user.role);
}

/**
 * Returns the set of client IDs this user can access.
 * - OWNER: all clients in the org
 * - TEAM/VIEWER: only assigned clients
 * - CLIENT: only the client where they are the portalUser
 */
export async function getAccessibleClientIds(user: User): Promise<string[]> {
  if (user.role === "OWNER") {
    const all = await db.client.findMany({ select: { id: true } });
    return all.map((c) => c.id);
  }
  if (user.role === "CLIENT") {
    const c = await db.client.findFirst({
      where: { portalUserId: user.id },
      select: { id: true },
    });
    return c ? [c.id] : [];
  }
  // TEAM / VIEWER
  const assigned = await db.clientAssignee.findMany({
    where: { userId: user.id },
    select: { clientId: true },
  });
  return assigned.map((a) => a.clientId);
}
