import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res } from "@nestjs/common";
import * as argon2 from "argon2";
import type { Response } from "express";
import { z } from "zod";
import {
  AuthContext, AuthedRequest, CurrentAuth, csrfFor, newToken, Public, SESSION_COOKIE, sha256,
} from "../core/auth";
import { AuditService } from "../core/audit.service";
import { config } from "../core/config";
import { Db } from "../core/db.service";
import { AppError, notFound } from "../core/errors";
import { normalisePhone, Zod } from "../core/validation";

const loginBody = z.object({ identifier: z.string().trim().min(3).max(200), password: z.string().min(1).max(200) });

// A real hash, so unknown users take as long to reject as known ones.
const DUMMY_HASH = argon2.hash("not-a-real-password-" + Math.random());

/** In-process limiter: 10 attempts / minute per IP. Swap for Redis when running more than one API instance. */
const attempts = new Map<string, { n: number; reset: number }>();
function rateLimit(key: string, max = config.loginRatePerMinute, windowMs = 60_000) {
  const now = Date.now();
  const e = attempts.get(key);
  if (!e || e.reset < now) attempts.set(key, { n: 1, reset: now + windowMs });
  else if (++e.n > max) throw new AppError(429, "RATE_LIMITED", "Too many attempts. Try again in a minute.");
}

export function serialiseMe(auth: AuthContext) {
  const permissions = [...auth.grants.keys()].sort();
  const branchSets = [...auth.grants.values()];
  const branchIds = branchSets.some((s) => s === "*") ? "*" : Array.from(new Set(branchSets.flat()));
  return {
    id: auth.userId,
    displayName: auth.displayName,
    kind: auth.memberId && !auth.staffId ? "MEMBER" : "STAFF",
    staffId: auth.staffId,
    memberId: auth.memberId,
    permissions,
    branchIds,
    csrfToken: auth.csrfToken,
  };
}

@Controller("auth")
export class AuthController {
  constructor(private readonly db: Db, private readonly audit: AuditService) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  async login(@Body(new Zod(loginBody)) body: z.infer<typeof loginBody>, @Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    rateLimit("login:" + (req.ip ?? "?"));
    const id = body.identifier.includes("@") ? body.identifier.toLowerCase() : normalisePhone(body.identifier);
    const user = await this.db.raw.user.findFirst({
      where: { deletedAt: null, OR: [{ email: id }, { phone: id }] },
    });

    const fail = async (reason: string) => {
      await this.audit.log(this.db.raw, { userId: user?.id, action: "auth.login", result: "FAILED", metadata: { reason } });
      throw new AppError(401, "INVALID_CREDENTIALS", "Wrong email/phone or password");
    };

    if (!user || !user.passwordHash) {
      await argon2.verify(await DUMMY_HASH, body.password).catch(() => false);
      return fail("unknown_user");
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError(423, "ACCOUNT_LOCKED", "Too many failed attempts. Try again in 15 minutes or reset your password.");
    }
    if (user.status !== "ACTIVE") return fail("inactive");

    const ok = await argon2.verify(user.passwordHash, body.password).catch(() => false);
    if (!ok) {
      const failures = user.failedLoginCount + 1;
      const lock = failures >= config.loginMaxFailures;
      await this.db.raw.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: lock ? 0 : failures,
          lockedUntil: lock ? new Date(Date.now() + config.loginLockMinutes * 60_000) : undefined,
        },
      });
      return fail(lock ? "bad_password_locked" : "bad_password");
    }

    const token = newToken();
    const csrf = csrfFor(token);
    const expiresAt = new Date(Date.now() + config.sessionAbsoluteHours * 3600_000);
    await this.db.raw.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
      const s = await tx.session.create({
        data: {
          userId: user.id,
          tokenHash: sha256(token),
          csrfSecretHash: sha256(csrf),
          ipAddress: req.ip && /^[0-9a-f:.]+$/i.test(req.ip) ? req.ip.replace(/^::ffff:/, "") : null,
          userAgent: String(req.headers["user-agent"] ?? "").slice(0, 300),
          deviceLabel: deviceLabel(String(req.headers["user-agent"] ?? "")),
          expiresAt,
        },
      });
      await this.audit.log(tx, { userId: user.id, action: "auth.login", entityType: "Session", entityId: s.id });
    });

    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: config.isProd,
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    });
    return { status: "AUTHENTICATED", csrfToken: csrf };
  }

  @Post("logout")
  @HttpCode(204)
  async logout(@CurrentAuth() auth: AuthContext, @Res({ passthrough: true }) res: Response) {
    await this.db.raw.session.update({ where: { id: auth.sessionId }, data: { revokedAt: new Date(), revokeReason: "logout" } });
    await this.audit.log(this.db.raw, { userId: auth.userId, action: "auth.logout", entityType: "Session", entityId: auth.sessionId });
    res.clearCookie(SESSION_COOKIE, { path: "/" });
  }

  @Get("me")
  me(@CurrentAuth() auth: AuthContext) {
    return serialiseMe(auth);
  }

  @Get("sessions")
  async sessions(@CurrentAuth() auth: AuthContext) {
    const rows = await this.db.raw.session.findMany({
      where: { userId: auth.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: "desc" },
    });
    return rows.map((s) => ({
      id: s.id, deviceLabel: s.deviceLabel, ipAddress: s.ipAddress, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt,
      current: s.id === auth.sessionId,
    }));
  }

  @Delete("sessions/:id")
  @HttpCode(204)
  async revoke(@CurrentAuth() auth: AuthContext, @Param("id") id: string) {
    const r = await this.db.raw.session.updateMany({
      where: { id, userId: auth.userId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: "user_revoked" },
    });
    if (r.count === 0) throw notFound("Session");
  }
}

function deviceLabel(ua: string): string {
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}
