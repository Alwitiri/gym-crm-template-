import {
  CanActivate, createParamDecorator, ExecutionContext, Injectable, SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { config } from "./config";
import { BranchScope, Db, Scope } from "./db.service";
import { ClsStore } from "./request-context";
import { AppError, forbidden } from "./errors";
import type { Permission } from "./permissions";

export const SESSION_COOKIE = "gym_sid";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
/** CSRF token is derived from the session token, so nothing extra is stored and it survives reloads. */
export const csrfFor = (sessionToken: string) => createHmac("sha256", config.sessionSecret).update("csrf:" + sessionToken).digest("base64url");

export interface AuthContext {
  sessionId: string;
  userId: string;
  displayName: string;
  csrfToken: string;
  staffId: string | null;
  memberId: string | null;
  /** permission → branches where it is granted */
  grants: Map<Permission, BranchScope>;
}

export interface AuthedRequest extends Request {
  requestId?: string;
  auth?: AuthContext;
  /** Set by the guard: the scope for the permission that let this request through. */
  scope?: Scope & { permission: Permission };
}

const PUBLIC = "isPublic";
const PERMS = "permissions";

export const Public = () => SetMetadata(PUBLIC, true);
/** Any one of the listed permissions is enough; the first one the user holds decides the branch scope. */
export const Requires = (...perms: Permission[]) => SetMetadata(PERMS, perms);

export const CurrentScope = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.scope) throw forbidden();
  return req.scope;
});
export const CurrentAuth = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AuthedRequest>().auth);

function mergeScope(a: BranchScope | undefined, b: BranchScope): BranchScope {
  if (a === "*" || b === "*") return "*";
  return Array.from(new Set([...(a ?? []), ...b]));
}

export function scopeFor(auth: AuthContext, perm: Permission): BranchScope | undefined {
  return auth.grants.get(perm);
}

export function has(auth: AuthContext | undefined, perm: Permission): boolean {
  return !!auth?.grants.has(perm);
}

@Injectable()
export class SessionService {
  constructor(private readonly db: Db) {}

  /** Member rows are behind row-level security, so the lookup runs in a scoped transaction. */
  private memberIdFor(userId: string) {
    return this.db.run({ userId, branchIds: "*" }, async (tx) => (await tx.member.findFirst({ where: { userId, deletedAt: null }, select: { id: true } }))?.id ?? null);
  }

  async load(token: string): Promise<AuthContext | null> {
    const session = await this.db.raw.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: {
        user: {
          include: {
            staff: { select: { id: true } },
            roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
          },
        },
      },
    });
    const now = new Date();
    if (!session || session.revokedAt || session.expiresAt <= now) return null;
    const idleLimit = new Date(session.lastSeenAt.getTime() + config.sessionIdleMinutes * 60_000);
    if (idleLimit <= now) {
      await this.db.raw.session.update({ where: { id: session.id }, data: { revokedAt: now, revokeReason: "idle_timeout" } });
      return null;
    }
    const user = session.user;
    if (user.status !== "ACTIVE" || user.deletedAt) return null;

    const grants = new Map<Permission, BranchScope>();
    for (const ur of user.roles) {
      const branches: BranchScope = ur.branchId ? [ur.branchId] : "*";
      for (const rp of ur.role.permissions) {
        const key = rp.permission.key as Permission;
        grants.set(key, mergeScope(grants.get(key), branches));
      }
    }

    // Sliding activity timestamp, written at most once a minute.
    if (now.getTime() - session.lastSeenAt.getTime() > 60_000) {
      await this.db.raw.session.update({ where: { id: session.id }, data: { lastSeenAt: now } });
    }

    return {
      sessionId: session.id,
      userId: user.id,
      displayName: user.displayName,
      csrfToken: csrfFor(token),
      staffId: user.staff?.id ?? null,
      memberId: user.staff ? null : await this.memberIdFor(user.id),
      grants,
    };
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly sessions: SessionService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;

    const token = req.cookies?.[SESSION_COOKIE];
    const auth = typeof token === "string" && token.length > 20 ? await this.sessions.load(token) : null;
    if (!auth) throw new AppError(401, "UNAUTHENTICATED", "Please sign in");
    req.auth = auth;
    ClsStore.setUser(auth.userId);

    // CSRF: every state-changing request must echo the token from /auth/me.
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const sent = String(req.headers["x-csrf-token"] ?? "");
      const a = Buffer.from(sent);
      const b = Buffer.from(auth.csrfToken);
      if (a.length !== b.length || !timingSafeEqual(a, b)) throw new AppError(403, "CSRF_FAILED", "Security token missing or expired. Reload the page.");
    }

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMS, targets);
    if (!required || required.length === 0) return true; // authenticated-only route
    for (const p of required) {
      const scope = auth.grants.get(p);
      if (scope) {
        req.scope = { userId: auth.userId, branchIds: scope, permission: p };
        return true;
      }
    }
    throw forbidden();
  }
}
