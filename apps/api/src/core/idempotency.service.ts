import { Injectable } from "@nestjs/common";
import { Db } from "./db.service";
import { AppError, conflict } from "./errors";
import { sha256 } from "./auth";

const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Makes money-moving POSTs safe to retry. The key row is claimed before the work runs,
 * so two concurrent retries can't both execute.
 */
@Injectable()
export class Idempotency {
  constructor(private readonly db: Db) {}

  async run<T>(userId: string, key: string | undefined, endpoint: string, body: unknown, work: () => Promise<T>): Promise<T> {
    if (!key || !KEY.test(key)) throw new AppError(400, "IDEMPOTENCY_KEY_REQUIRED", "Send a UUID in the Idempotency-Key header");
    const requestHash = sha256(endpoint + "\n" + JSON.stringify(body ?? null));
    const existing = await this.db.raw.idempotencyKey.findUnique({ where: { userId_key: { userId, key } } });
    if (existing) {
      if (existing.requestHash !== requestHash) throw conflict("IDEMPOTENCY_KEY_REUSED", "This key was already used for a different request");
      if (existing.responseCode == null) throw conflict("REQUEST_IN_PROGRESS", "The same request is still being processed");
      return existing.responseBody as T;
    }
    try {
      await this.db.raw.idempotencyKey.create({
        data: { userId, key, endpoint, requestHash, expiresAt: new Date(Date.now() + 24 * 3600_000) },
      });
    } catch {
      throw conflict("REQUEST_IN_PROGRESS", "The same request is still being processed");
    }
    try {
      const result = await work();
      await this.db.raw.idempotencyKey.update({
        where: { userId_key: { userId, key } },
        data: { responseCode: 200, responseBody: JSON.parse(JSON.stringify(result)) },
      });
      return result;
    } catch (e) {
      // Failed work releases the key so the client can retry after fixing the problem.
      await this.db.raw.idempotencyKey.delete({ where: { userId_key: { userId, key } } }).catch(() => undefined);
      throw e;
    }
  }
}
