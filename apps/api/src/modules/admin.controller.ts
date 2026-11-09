import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import * as argon2 from "argon2";
import { z } from "zod";
import { AuditService } from "../core/audit.service";
import { AuthContext, CurrentAuth, CurrentScope, Public, Requires } from "../core/auth";
import { branchWhere, Db, Scope } from "../core/db.service";
import { forbidden, notFound, unprocessable } from "../core/errors";
import type { Permission } from "../core/permissions";
import { SETTINGS_PATCH, SettingsService } from "../core/settings.service";
import { Zod, zUuid } from "../core/validation";

type S = Scope & { permission: Permission };

const businessBody = z.object({
  brandName: z.string().trim().min(2).max(80),
  legalName: z.string().trim().min(2).max(120),
  gstin: z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "Enter a valid 15-character GSTIN").nullish().or(z.literal("").transform(() => null)),
  pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "Enter a valid PAN").nullish().or(z.literal("").transform(() => null)),
  stateCode: z.string().regex(/^\d{2}$/),
}).partial();

const password = z.string().min(10, "Use at least 10 characters").max(128);

const staffPatch = z.object({
  displayName: z.string().trim().min(2).max(80).optional(),
  designation: z.string().trim().min(2).max(60).optional(),
  isTrainer: z.boolean().optional(),
  specializations: z.array(z.string().trim().max(40)).max(10).optional(),
  roles: z.array(z.object({ roleKey: z.string(), branchId: zUuid.nullable() })).min(1).optional(),
});

@Controller()
export class AdminController {
  constructor(private readonly db: Db, private readonly audit: AuditService, private readonly settings: SettingsService) {}

  /** Name shown on the login page, member app and join page. No secrets here. */
  @Public()
  @Get("public/branding")
  async branding() {
    const [b, s, branches] = await Promise.all([
      this.settings.business(),
      this.settings.get(),
      this.db.raw.branch.findMany({ where: { status: "ACTIVE" }, select: { code: true, name: true, city: true, addressLine1: true, phone: true }, orderBy: { code: "asc" } }),
    ]);
    return { brandName: b.brandName, phone: s["business.phone"], email: s["business.email"], website: s["business.website"], branches, privacyNoticeVersion: s["privacy.noticeVersion"] };
  }

  @Get("settings")
  @Requires("settings.read", "settings.manage")
  async getSettings() {
    return { business: await this.settings.business(), rules: await this.settings.get() };
  }

  @Patch("settings")
  @Requires("settings.manage")
  async patchSettings(@CurrentScope() scope: S, @Body(new Zod(z.object({ business: businessBody.optional(), rules: SETTINGS_PATCH.optional() }))) body: { business?: z.infer<typeof businessBody>; rules?: Record<string, unknown> }) {
    if (scope.branchIds !== "*") throw forbidden("Only business-wide admins can change these settings");
    const before = { business: await this.settings.business(), rules: await this.settings.get() };
    if (body.business && Object.keys(body.business).length) {
      const b = await this.db.raw.business.findFirst();
      if (b) await this.db.raw.business.update({ where: { id: b.id }, data: body.business as any });
      else await this.db.raw.business.create({ data: { brandName: body.business.brandName ?? "Your Gym", legalName: body.business.legalName ?? body.business.brandName ?? "Your Gym", stateCode: body.business.stateCode ?? "33", gstin: body.business.gstin, pan: body.business.pan } });
    }
    if (body.rules) await this.settings.set(scope.userId, body.rules as any);
    const after = { business: await this.settings.business(), rules: await this.settings.get() };
    await this.audit.log(this.db.raw, { userId: scope.userId, action: "settings.update", entityType: "Settings", before, after });
    return after;
  }

  // ---------------- Own password ----------------
  @Post("auth/password")
  @HttpCode(204)
  async changeOwnPassword(@CurrentAuth() auth: AuthContext, @Body(new Zod(z.object({ currentPassword: z.string().min(1), newPassword: password }))) body: { currentPassword: string; newPassword: string }) {
    const u = await this.db.raw.user.findUniqueOrThrow({ where: { id: auth.userId } });
    if (!u.passwordHash || !(await argon2.verify(u.passwordHash, body.currentPassword).catch(() => false))) {
      throw unprocessable("WRONG_PASSWORD", "Your current password is wrong");
    }
    if (body.currentPassword === body.newPassword) throw unprocessable("SAME_PASSWORD", "Choose a different password");
    await this.db.raw.user.update({ where: { id: u.id }, data: { passwordHash: await argon2.hash(body.newPassword, { type: argon2.argon2id }), passwordChangedAt: new Date() } });
    // Sign out everywhere else.
    await this.db.raw.session.updateMany({ where: { userId: u.id, revokedAt: null, id: { not: auth.sessionId } }, data: { revokedAt: new Date(), revokeReason: "password_changed" } });
    await this.audit.log(this.db.raw, { userId: u.id, action: "auth.password.change", entityType: "User", entityId: u.id });
  }

  // ---------------- Staff management ----------------
  private async staffInScope(scope: S, id: string) {
    const s = await this.db.raw.staff.findFirst({ where: { id, ...branchWhere(scope.branchIds) }, include: { user: { include: { roles: { include: { role: true } } } } } });
    if (!s) throw notFound("Staff member");
    return s;
  }

  @Patch("staff/:id")
  @Requires("staff.manage")
  async updateStaff(@CurrentScope() scope: S, @CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Body(new Zod(staffPatch)) body: z.infer<typeof staffPatch>) {
    const s = await this.staffInScope(scope, id);
    if (body.roles) {
      if (s.userId === auth.userId) throw forbidden("You can't change your own roles");
      for (const r of body.roles) {
        if (scope.branchIds !== "*" && (r.branchId === null || !scope.branchIds.includes(r.branchId) || r.roleKey === "OWNER")) throw forbidden("You can only grant non-owner roles at your own branches");
      }
      const roles = await this.db.raw.role.findMany({ where: { key: { in: body.roles.map((r) => r.roleKey) } } });
      if (roles.length !== new Set(body.roles.map((r) => r.roleKey)).size) throw notFound("Role");
      await this.db.raw.$transaction([
        this.db.raw.userRole.deleteMany({ where: { userId: s.userId } }),
        this.db.raw.userRole.createMany({ data: body.roles.map((r) => ({ userId: s.userId, roleId: roles.find((x) => x.key === r.roleKey)!.id, branchId: r.branchId, grantedById: auth.userId })) }),
        // Permissions change immediately: sign them out so the new roles load.
        this.db.raw.session.updateMany({ where: { userId: s.userId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: "roles_changed" } }),
      ]);
    }
    if (body.displayName) await this.db.raw.user.update({ where: { id: s.userId }, data: { displayName: body.displayName } });
    await this.db.raw.staff.update({ where: { id }, data: { designation: body.designation, isTrainer: body.isTrainer, specializations: body.specializations } });
    await this.audit.log(this.db.raw, {
      userId: auth.userId, branchId: s.branchId, action: "staff.update", entityType: "Staff", entityId: id,
      before: { roles: s.user.roles.map((r) => ({ roleKey: r.role.key, branchId: r.branchId })), designation: s.designation, isTrainer: s.isTrainer },
      after: body,
    });
    return { ok: true };
  }

  @Post("staff/:id/deactivate")
  @HttpCode(200)
  @Requires("staff.manage")
  async deactivate(@CurrentScope() scope: S, @CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Body(new Zod(z.object({ reassignMembersToTrainerId: zUuid.optional(), reason: z.string().max(200).optional() }))) body: { reassignMembersToTrainerId?: string; reason?: string }) {
    const s = await this.staffInScope(scope, id);
    if (s.userId === auth.userId) throw forbidden("You can't deactivate yourself");
    if (s.user.roles.some((r) => r.role.key === "OWNER") && scope.branchIds !== "*") throw forbidden();
    const active = await this.db.raw.trainerAssignment.count({ where: { trainerId: id, endedAt: null } });
    if (active && !body.reassignMembersToTrainerId) throw unprocessable("HAS_MEMBERS", `This trainer has ${active} members. Choose who takes them over.`, { activeMembers: active });
    await this.db.raw.$transaction(async (tx) => {
      if (active) {
        const target = await tx.staff.findFirst({ where: { id: body.reassignMembersToTrainerId, isTrainer: true, employmentStatus: { not: "EXITED" } } });
        if (!target || target.id === id) throw notFound("Trainer to take over");
        const list = await tx.trainerAssignment.findMany({ where: { trainerId: id, endedAt: null } });
        await tx.trainerAssignment.updateMany({ where: { trainerId: id, endedAt: null }, data: { endedAt: new Date(), endReason: "Trainer left" } });
        await tx.trainerAssignment.createMany({ data: list.map((a) => ({ memberId: a.memberId, trainerId: target.id })) });
        await tx.ptSession.updateMany({ where: { trainerId: id, status: "SCHEDULED" }, data: { trainerId: target.id } });
        await tx.memberPtPackage.updateMany({ where: { trainerId: id, status: { in: ["ACTIVE", "PENDING_PAYMENT"] } }, data: { trainerId: target.id } });
      }
      await tx.staff.update({ where: { id }, data: { employmentStatus: "EXITED", exitedOn: new Date() } });
      await tx.user.update({ where: { id: s.userId }, data: { status: "INACTIVE" } });
      await tx.userRole.deleteMany({ where: { userId: s.userId } });
      await tx.session.updateMany({ where: { userId: s.userId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: "deactivated" } });
      await this.audit.log(tx, { userId: auth.userId, branchId: s.branchId, action: "staff.deactivate", entityType: "Staff", entityId: id, metadata: { reason: body.reason, membersMoved: active } });
    });
    return { ok: true, membersMoved: active };
  }

  @Post("staff/:id/reset-password")
  @HttpCode(204)
  @Requires("staff.manage")
  async resetPassword(@CurrentScope() scope: S, @CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Body(new Zod(z.object({ newPassword: password }))) body: { newPassword: string }) {
    const s = await this.staffInScope(scope, id);
    if (s.user.roles.some((r) => r.role.key === "OWNER") && s.userId !== auth.userId && scope.branchIds !== "*") throw forbidden();
    await this.db.raw.user.update({ where: { id: s.userId }, data: { passwordHash: await argon2.hash(body.newPassword, { type: argon2.argon2id }), passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null } });
    await this.db.raw.session.updateMany({ where: { userId: s.userId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: "password_reset" } });
    await this.audit.log(this.db.raw, { userId: auth.userId, branchId: s.branchId, action: "staff.password.reset", entityType: "Staff", entityId: id });
  }
}
