import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export interface WriteAuditInput {
  userId: string | null;
  organizationId: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Insert a row into the AuditLog table. Never throws — a failed audit
 * write must not roll back the parent mutation.
 */
export async function writeAudit(input: WriteAuditInput): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        userId: input.userId,
        organizationId: input.organizationId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: (input.metadata ?? undefined) as
          | Prisma.InputJsonValue
          | undefined,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[writeAudit] failed to write audit log", {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
