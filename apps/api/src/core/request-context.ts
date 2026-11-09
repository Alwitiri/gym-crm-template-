import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

interface Ctx {
  requestId: string;
  ip?: string;
  userId?: string;
}

const als = new AsyncLocalStorage<Ctx>();

export const ClsStore = {
  get: () => als.getStore(),
  setUser: (userId: string) => {
    const s = als.getStore();
    if (s) s.userId = userId;
  },
};

export function requestContext(req: Request & { requestId?: string }, res: Response, next: NextFunction) {
  const incoming = req.headers["x-request-id"];
  const requestId = typeof incoming === "string" && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  // Validate the IP so a spoofed header can't break the inet column.
  const ip = req.ip && /^[0-9a-f:.]+$/i.test(req.ip) ? req.ip.replace(/^::ffff:/, "") : undefined;
  als.run({ requestId, ip }, next);
}
