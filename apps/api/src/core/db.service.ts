import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../generated/prisma/client";
import { config } from "./config";

export type Tx = Prisma.TransactionClient;

/** Branch scope for one request: '*' = every branch, otherwise an explicit list (may be empty = nothing). */
export type BranchScope = "*" | string[];

export interface Scope {
  userId: string;
  branchIds: BranchScope;
}

@Injectable()
export class Db implements OnModuleDestroy {
  /** Unscoped client. Only for auth/session tables and other non-branch data. */
  readonly raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: config.databaseUrl }) });

  /**
   * Runs `fn` in a transaction with the PostgreSQL row-level-security context set.
   * Every query touching branch-owned tables must go through here, so a missed
   * WHERE clause still cannot return another branch's rows.
   */
  run<T>(scope: Scope, fn: (tx: Tx) => Promise<T>, timeoutMs = 15_000): Promise<T> {
    const branchSetting = scope.branchIds === "*" ? "*" : scope.branchIds.join(",");
    return this.raw.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.branch_ids', ${branchSetting}, true), set_config('app.user_id', ${scope.userId}, true)`;
        return fn(tx);
      },
      { timeout: timeoutMs, maxWait: 5_000 },
    );
  }

  async onModuleDestroy() {
    await this.raw.$disconnect();
  }
}

/** Prisma `where` fragment restricting a branch column to the scope (belt and braces alongside RLS). */
export function branchWhere(scope: BranchScope, field = "branchId"): Record<string, unknown> {
  return scope === "*" ? {} : { [field]: { in: scope } };
}

export function inScope(scope: BranchScope, branchId: string): boolean {
  return scope === "*" || scope.includes(branchId);
}
