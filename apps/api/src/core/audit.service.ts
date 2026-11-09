import { Injectable } from "@nestjs/common";
import { ClsStore } from "./request-context";
import type { Tx } from "./db.service";
import type { Prisma } from "../generated/prisma/client";

const REDACT = /password|otp|token|secret|pan|bank/i;

function clean(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined || v === null) return undefined;
  return JSON.parse(
    JSON.stringify(v, (k, val) => (REDACT.test(k) ? "[redacted]" : typeof val === "bigint" ? val.toString() : val)),
  );
}

export interface AuditEntry {
  userId?: string | null;
  branchId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  result?: "SUCCESS" | "DENIED" | "FAILED";
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
}

@Injectable()
export class AuditService {
  /** Write inside the same transaction as the change, so the log and the data can't disagree. */
  async log(tx: Pick<Tx, "auditLog">, e: AuditEntry) {
    const ctx = ClsStore.get();
    await tx.auditLog.create({
      data: {
        userId: e.userId ?? ctx?.userId ?? null,
        branchId: e.branchId ?? null,
        requestId: ctx?.requestId,
        ipAddress: ctx?.ip,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId,
        result: e.result ?? "SUCCESS",
        before: clean(e.before),
        after: clean(e.after),
        metadata: clean(e.metadata),
      },
    });
  }
}
