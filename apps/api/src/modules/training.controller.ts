import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from "@nestjs/common";
import { z } from "zod";
import { AuditService } from "../core/audit.service";
import { AuthContext, CurrentAuth, CurrentScope, has, Requires } from "../core/auth";
import { dbDate, istDate, istDayStart, ymd } from "../core/dates";
import { branchWhere, Db, Scope, Tx } from "../core/db.service";
import { conflict, notFound, unprocessable } from "../core/errors";
import type { Permission } from "../core/permissions";
import { Zod, zDate, zUuid } from "../core/validation";
import type { Prisma } from "../generated/prisma/client";

type S = Scope & { permission: Permission };
const NONE = "00000000-0000-0000-0000-000000000000";

const GOALS = ["FAT_LOSS", "MUSCLE_GAIN", "STRENGTH", "ENDURANCE", "GENERAL"] as const;

const workoutBody = z.object({
  name: z.string().trim().min(2).max(80),
  goal: z.enum(GOALS),
  startDate: zDate,
  endDate: zDate.nullish(),
  notes: z.string().max(2000).nullish(),
  isActive: z.boolean().default(true),
  exercises: z.array(z.object({
    exerciseId: zUuid,
    dayLabel: z.string().trim().max(40).nullish(),
    sets: z.number().int().min(1).max(20),
    reps: z.string().trim().min(1).max(20),
    weightKg: z.number().min(0).max(500).nullish(),
    restSeconds: z.number().int().min(0).max(900).nullish(),
    notes: z.string().max(200).nullish(),
  })).min(1).max(80),
});

const food = z.object({
  food: z.string().trim().min(1).max(80),
  portion: z.string().trim().max(40).optional(),
  calories: z.number().int().min(0).max(5000).optional(),
  proteinG: z.number().min(0).max(500).optional(),
});
const dietBody = z.object({
  name: z.string().trim().min(2).max(80),
  startDate: zDate,
  dailyCalories: z.number().int().min(500).max(8000).nullish(),
  proteinG: z.number().int().min(0).max(500).nullish(),
  carbsG: z.number().int().min(0).max(1000).nullish(),
  fatG: z.number().int().min(0).max(400).nullish(),
  preferences: z.array(z.enum(["VEG", "EGGETARIAN", "NON_VEG", "JAIN", "VEGAN"])).default([]),
  allergies: z.array(z.string().trim().max(40)).default([]),
  notes: z.string().max(2000).nullish(),
  isActive: z.boolean().default(true),
  meals: z.array(z.object({
    mealTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    label: z.string().trim().min(1).max(40),
    items: z.array(food).min(1).max(20),
  })).min(1).max(10),
});

const metricBody = z.object({
  measuredOn: zDate,
  weightKg: z.number().min(20).max(300).nullish(),
  heightCm: z.number().min(100).max(250).nullish(),
  bodyFatPct: z.number().min(2).max(70).nullish(),
  waistCm: z.number().min(30).max(250).nullish(),
  chestCm: z.number().min(30).max(250).nullish(),
  notes: z.string().max(300).nullish(),
});

const assignBody = z.object({ trainerId: zUuid.nullable(), reason: z.string().trim().max(200).optional() });

function assignedTo(auth: AuthContext): Prisma.MemberWhereInput {
  return { trainerAssignments: { some: { trainerId: auth.staffId ?? NONE, endedAt: null } } };
}

@Controller()
export class TrainingController {
  constructor(private readonly db: Db, private readonly audit: AuditService) {}

  /** Member visible to the caller; `assigned` limits trainers to their own members. */
  private async member(tx: Tx, scope: S, auth: AuthContext, id: string, assigned: boolean) {
    const m = await tx.member.findFirst({
      where: { id, deletedAt: null, ...branchWhere(scope.branchIds, "homeBranchId"), ...(assigned ? assignedTo(auth) : {}) },
      include: { trainerAssignments: { where: { endedAt: null }, select: { trainerId: true } } },
    });
    if (!m) throw notFound("Member");
    return m;
  }

  /** Who may write plans: a trainer for their assigned members, or anyone with workouts.manage.any. */
  private async writableMember(tx: Tx, scope: S, auth: AuthContext, id: string) {
    const any = has(auth, "workouts.manage.any");
    const m = await this.member(tx, scope, auth, id, !any);
    const trainerId = auth.staffId && (await tx.staff.count({ where: { id: auth.staffId, isTrainer: true } }))
      ? auth.staffId
      : m.trainerAssignments[0]?.trainerId;
    if (!trainerId) throw unprocessable("NO_TRAINER", "Assign a trainer to this member first");
    return { m, trainerId };
  }

  // ---------------- Trainers ----------------
  @Get("trainers")
  @Requires("trainers.read")
  trainers(@CurrentScope() scope: S, @Query("branchId") branchId?: string) {
    return this.db.run(scope, async (tx) => {
      const today = istDate();
      const monthStart = istDayStart(today.slice(0, 8) + "01");
      const rows = await tx.staff.findMany({
        where: { isTrainer: true, employmentStatus: { not: "EXITED" }, ...branchWhere(scope.branchIds), ...(branchId ? { branchId } : {}) },
        include: {
          user: { select: { displayName: true, phone: true } },
          branch: { select: { name: true } },
          _count: { select: { assignments: { where: { endedAt: null } } } },
        },
        orderBy: { user: { displayName: "asc" } },
      });
      const sessions = await tx.ptSession.groupBy({
        by: ["trainerId", "status"],
        where: { trainerId: { in: rows.map((r) => r.id) }, scheduledStart: { gte: monthStart } },
        _count: { _all: true },
      });
      const todayCount = await tx.ptSession.groupBy({
        by: ["trainerId"],
        where: { trainerId: { in: rows.map((r) => r.id) }, status: "SCHEDULED", scheduledStart: { gte: istDayStart(today), lt: new Date(istDayStart(today).getTime() + 86_400_000) } },
        _count: { _all: true },
      });
      return rows.map((t) => ({
        id: t.id, userId: t.userId, displayName: t.user.displayName, phone: t.user.phone, branchId: t.branchId, branchName: t.branch.name,
        designation: t.designation, specializations: t.specializations, activeMembers: t._count.assignments,
        ptCompletedThisMonth: sessions.filter((s) => s.trainerId === t.id && s.status === "COMPLETED").reduce((a, s) => a + s._count._all, 0),
        ptToday: todayCount.find((s) => s.trainerId === t.id)?._count._all ?? 0,
      }));
    });
  }

  @Get("trainers/:id/members")
  @Requires("trainers.read")
  trainerMembers(@CurrentScope() scope: S, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.run(scope, async (tx) => {
      const rows = await tx.trainerAssignment.findMany({
        where: { trainerId: id, endedAt: null, member: { deletedAt: null, ...branchWhere(scope.branchIds, "homeBranchId") } },
        include: { member: { select: { id: true, firstName: true, lastName: true, memberCode: true, status: true } } },
        orderBy: { startedAt: "desc" },
      });
      return rows.map((r) => ({ ...r.member, fullName: [r.member.firstName, r.member.lastName].filter(Boolean).join(" "), since: r.startedAt }));
    });
  }

  @Put("members/:id/trainer")
  @Requires("trainers.assign")
  assign(@CurrentScope() scope: S, @CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Body(new Zod(assignBody)) body: z.infer<typeof assignBody>) {
    return this.db.run(scope, async (tx) => {
      const m = await this.member(tx, scope, auth, id, false);
      const current = await tx.trainerAssignment.findFirst({ where: { memberId: id, endedAt: null }, include: { trainer: { include: { user: { select: { displayName: true } } } } } });
      if ((current?.trainerId ?? null) === body.trainerId) return { trainerId: body.trainerId };
      let trainerName: string | null = null;
      if (body.trainerId) {
        const t = await tx.staff.findFirst({ where: { id: body.trainerId, isTrainer: true, employmentStatus: { not: "EXITED" } }, include: { user: { select: { displayName: true } } } });
        if (!t) throw notFound("Trainer");
        trainerName = t.user.displayName;
      }
      if (current) await tx.trainerAssignment.update({ where: { id: current.id }, data: { endedAt: new Date(), endReason: body.reason ?? "Reassigned" } });
      if (body.trainerId) await tx.trainerAssignment.create({ data: { memberId: id, trainerId: body.trainerId } });
      await this.audit.log(tx, {
        userId: scope.userId, branchId: m.homeBranchId, action: "member.trainer.assign", entityType: "Member", entityId: id,
        before: { trainer: current?.trainer.user.displayName ?? null }, after: { trainer: trainerName, reason: body.reason },
      });
      return { trainerId: body.trainerId, trainerName };
    });
  }

  // ---------------- Exercise library ----------------
  @Get("exercises")
  @Requires("workouts.read", "workouts.read.assigned")
  exercises(@Query("q") q?: string, @Query("muscleGroup") muscleGroup?: string) {
    return this.db.raw.exercise.findMany({
      where: { status: "ACTIVE", ...(q ? { name: { contains: q, mode: "insensitive" } } : {}), ...(muscleGroup ? { muscleGroup } : {}) },
      orderBy: [{ muscleGroup: "asc" }, { name: "asc" }],
    });
  }

  @Post("exercises")
  @Requires("workouts.library.manage")
  async addExercise(@CurrentScope() scope: S, @Body(new Zod(z.object({ name: z.string().trim().min(2).max(80), muscleGroup: z.string().trim().min(2).max(40), equipment: z.string().trim().max(40).optional(), instructions: z.string().max(1000).optional() }))) body: { name: string; muscleGroup: string; equipment?: string; instructions?: string }) {
    const exists = await this.db.raw.exercise.findFirst({ where: { name: { equals: body.name, mode: "insensitive" } } });
    if (exists) throw conflict("ALREADY_EXISTS", `${exists.name} is already in the library`);
    const e = await this.db.raw.exercise.create({ data: body });
    await this.audit.log(this.db.raw, { userId: scope.userId, action: "exercise.create", entityType: "Exercise", entityId: e.id, after: body });
    return e;
  }

  // ---------------- Workout plans ----------------
  @Get("members/:id/workout-plans")
  @Requires("workouts.read", "workouts.read.assigned")
  workoutPlans(@CurrentScope() scope: S, @CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.run(scope, async (tx) => {
      await this.member(tx, scope, auth, id, scope.permission === "workouts.read.assigned");
      const plans = await tx.workoutPlan.findMany({
        where: { memberId: id },
        orderBy: [{ isActive: "desc" }, { startDate: "desc" }],
        include: { trainer: { include: { user: { select: { displayName: true } } } }, exercises: { orderBy: { sortOrder: "asc" }, include: { exercise: true } } },
      });
      return plans.map(serialiseWorkout);
    });
  }

  @Get("workout-plans/:id")
  @Requires("workouts.read", "workouts.read.assigned")
  workoutPlan(@CurrentScope() scope: S, @CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.run(scope, async (tx) => {
      const p = await tx.workoutPlan.findFirst({
        where: { id, member: { deletedAt: null, ...branchWhere(scope.branchIds, "homeBranchId"), ...(scope.permission === "workouts.read.assigned" ? assignedTo(auth) : {}) } },
        include: { trainer: { include: { user: { select: { displayName: true } } } }, exercises: { orderBy: { sortOrder: "asc" }, include: { exercise: true } }, member: { select: { firstName: true, lastName: true, memberCode: true } } },
      });
      if (!p) throw notFound("Workout plan");
      return { ...serialiseWorkout(p), memberName: [p.member.firstName, p.member.lastName].filter(Boolean).join(" "), memberCode: p.member.memberCode };
    });
  }

  @Post("members/:id/workout-plans")
  @Requires("workouts.manage", "workouts.manage.any")
  createWorkout(@CurrentScope() scope: S, @CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Body(new Zod(workoutBody)) body: z.infer<typeof workoutBody>) {
    return this.db.run(scope, async (tx) => {
      const { m, trainerId } = await this.writableMember(tx, scope, auth, id);
      if (body.isActive) await tx.workoutPlan.updateMany({ where: { memberId: id, isActive: true }, data: { isActive: false } });
      const p = await tx.workoutPlan.create({
        data: {
          memberId: id, trainerId, name: body.name, goal: body.goal, startDate: dbDate(body.startDate), endDate: body.endDate ? dbDate(body.endDate) : null,
          notes: body.notes, isActive: body.isActive,
          exercises: { create: body.exercises.map((e, i) => ({ ...e, sortOrder: i, weightKg: e.weightKg ?? null })) },
        },
        include: { trainer: { include: { user: { select: { displayName: true } } } }, exercises: { orderBy: { sortOrder: "asc" }, include: { exercise: true } } },
      });
      await this.audit.log(tx, { userId: scope.userId, branchId: m.homeBranchId, action: "workout.create", entityType: "WorkoutPlan", entityId: p.id, after: { name: body.name, exercises: body.exercises.length } });
      return serialiseWorkout(p);
    });
  }

  @Put("workout-plans/:id")
  @Requires("workouts.manage", "workouts.manage.any")
  replaceWorkout(@CurrentScope() scope: S, @CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Body(new Zod(workoutBody)) body: z.infer<typeof workoutBody>) {
    return this.db.run(scope, async (tx) => {
      const existing = await tx.workoutPlan.findUnique({ where: { id } });
      if (!existing) throw notFound("Workout plan");
      const { m } = await this.writableMember(tx, scope, auth, existing.memberId);
      if (body.isActive && !existing.isActive) await tx.workoutPlan.updateMany({ where: { memberId: existing.memberId, isActive: true }, data: { isActive: false } });
      await tx.workoutPlanExercise.deleteMany({ where: { workoutPlanId: id } });
      const p = await tx.workoutPlan.update({
        where: { id },
        data: {
          name: body.name, goal: body.goal, startDate: dbDate(body.startDate), endDate: body.endDate ? dbDate(body.endDate) : null, notes: body.notes, isActive: body.isActive,
          exercises: { create: body.exercises.map((e, i) => ({ ...e, sortOrder: i, weightKg: e.weightKg ?? null })) },
        },
        include: { trainer: { include: { user: { select: { displayName: true } } } }, exercises: { orderBy: { sortOrder: "asc" }, include: { exercise: true } } },
      });
      await this.audit.log(tx, { userId: scope.userId, branchId: m.homeBranchId, action: "workout.update", entityType: "WorkoutPlan", entityId: id, after: { name: body.name, exercises: body.exercises.length, isActive: body.isActive } });
      return serialiseWorkout(p);
    });
  }

  // ---------------- Diet plans ----------------
  @Get("members/:id/diet-plans")
  @Requires("workouts.read", "workouts.read.assigned")
  dietPlans(@CurrentScope() scope: S, @CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.run(scope, async (tx) => {
      await this.member(tx, scope, auth, id, scope.permission === "workouts.read.assigned");
      const plans = await tx.dietPlan.findMany({
        where: { memberId: id }, orderBy: [{ isActive: "desc" }, { startDate: "desc" }],
        include: { meals: { orderBy: { sortOrder: "asc" } }, trainer: { include: { user: { select: { displayName: true } } } } },
      });
      return plans.map(serialiseDiet);
    });
  }

  @Get("diet-plans/:id")
  @Requires("workouts.read", "workouts.read.assigned")
  dietPlan(@CurrentScope() scope: S, @CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.run(scope, async (tx) => {
      const p = await tx.dietPlan.findFirst({
        where: { id, member: { deletedAt: null, ...branchWhere(scope.branchIds, "homeBranchId"), ...(scope.permission === "workouts.read.assigned" ? assignedTo(auth) : {}) } },
        include: { meals: { orderBy: { sortOrder: "asc" } }, trainer: { include: { user: { select: { displayName: true } } } }, member: { select: { firstName: true, lastName: true, memberCode: true } } },
      });
      if (!p) throw notFound("Diet plan");
      return { ...serialiseDiet(p), memberName: [p.member.firstName, p.member.lastName].filter(Boolean).join(" "), memberCode: p.member.memberCode };
    });
  }

  @Post("members/:id/diet-plans")
  @Requires("workouts.manage", "workouts.manage.any")
  createDiet(@CurrentScope() scope: S, @CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Body(new Zod(dietBody)) body: z.infer<typeof dietBody>) {
    return this.db.run(scope, async (tx) => {
      const { m, trainerId } = await this.writableMember(tx, scope, auth, id);
      if (body.isActive) await tx.dietPlan.updateMany({ where: { memberId: id, isActive: true }, data: { isActive: false } });
      const { meals, ...rest } = body;
      const p = await tx.dietPlan.create({
        data: { ...rest, memberId: id, trainerId, startDate: dbDate(body.startDate), meals: { create: meals.map((x, i) => ({ ...x, sortOrder: i })) } },
        include: { meals: { orderBy: { sortOrder: "asc" } }, trainer: { include: { user: { select: { displayName: true } } } } },
      });
      await this.audit.log(tx, { userId: scope.userId, branchId: m.homeBranchId, action: "diet.create", entityType: "DietPlan", entityId: p.id, after: { name: body.name, meals: meals.length } });
      return serialiseDiet(p);
    });
  }

  @Put("diet-plans/:id")
  @Requires("workouts.manage", "workouts.manage.any")
  replaceDiet(@CurrentScope() scope: S, @CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Body(new Zod(dietBody)) body: z.infer<typeof dietBody>) {
    return this.db.run(scope, async (tx) => {
      const existing = await tx.dietPlan.findUnique({ where: { id } });
      if (!existing) throw notFound("Diet plan");
      const { m } = await this.writableMember(tx, scope, auth, existing.memberId);
      if (body.isActive && !existing.isActive) await tx.dietPlan.updateMany({ where: { memberId: existing.memberId, isActive: true }, data: { isActive: false } });
      await tx.dietMeal.deleteMany({ where: { dietPlanId: id } });
      const { meals, ...rest } = body;
      const p = await tx.dietPlan.update({
        where: { id },
        data: { ...rest, startDate: dbDate(body.startDate), meals: { create: meals.map((x, i) => ({ ...x, sortOrder: i })) } },
        include: { meals: { orderBy: { sortOrder: "asc" } }, trainer: { include: { user: { select: { displayName: true } } } } },
      });
      await this.audit.log(tx, { userId: scope.userId, branchId: m.homeBranchId, action: "diet.update", entityType: "DietPlan", entityId: id, after: { name: body.name, meals: meals.length } });
      return serialiseDiet(p);
    });
  }

  // ---------------- Body measurements ----------------
  @Get("members/:id/body-metrics")
  @Requires("workouts.read", "workouts.read.assigned")
  metrics(@CurrentScope() scope: S, @CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string) {
    return this.db.run(scope, async (tx) => {
      await this.member(tx, scope, auth, id, scope.permission === "workouts.read.assigned");
      const rows = await tx.bodyMetric.findMany({ where: { memberId: id }, orderBy: { measuredOn: "asc" } });
      return rows.map(serialiseMetric);
    });
  }

  @Post("members/:id/body-metrics")
  @Requires("workouts.manage", "workouts.manage.any")
  addMetric(@CurrentScope() scope: S, @CurrentAuth() auth: AuthContext, @Param("id", ParseUUIDPipe) id: string, @Body(new Zod(metricBody)) body: z.infer<typeof metricBody>) {
    if (body.measuredOn > istDate()) throw unprocessable("FUTURE_DATE", "Measurements can't be in the future");
    if (!body.weightKg && !body.bodyFatPct && !body.waistCm && !body.chestCm && !body.heightCm) throw unprocessable("EMPTY", "Enter at least one measurement");
    return this.db.run(scope, async (tx) => {
      await this.writableMember(tx, scope, auth, id).catch((e) => {
        if (e?.code === "NO_TRAINER" && has(auth, "workouts.manage.any")) return null;
        throw e;
      });
      const r = await tx.bodyMetric.create({
        data: {
          memberId: id, recordedById: auth.userId, measuredOn: dbDate(body.measuredOn),
          weightGrams: body.weightKg != null ? Math.round(body.weightKg * 1000) : null,
          heightMm: body.heightCm != null ? Math.round(body.heightCm * 10) : null,
          bodyFatBp: body.bodyFatPct != null ? Math.round(body.bodyFatPct * 100) : null,
          waistMm: body.waistCm != null ? Math.round(body.waistCm * 10) : null,
          chestMm: body.chestCm != null ? Math.round(body.chestCm * 10) : null,
          notes: body.notes,
        },
      });
      return serialiseMetric(r);
    });
  }
}

function serialiseWorkout(p: any) {
  return {
    id: p.id, memberId: p.memberId, trainerId: p.trainerId, trainerName: p.trainer?.user.displayName ?? null, name: p.name, goal: p.goal,
    startDate: ymd(p.startDate), endDate: p.endDate ? ymd(p.endDate) : null, notes: p.notes, isActive: p.isActive, updatedAt: p.updatedAt,
    exercises: p.exercises.map((e: any) => ({
      id: e.id, exerciseId: e.exerciseId, name: e.exercise.name, muscleGroup: e.exercise.muscleGroup, dayLabel: e.dayLabel, sets: e.sets,
      reps: e.reps, weightKg: e.weightKg == null ? null : Number(e.weightKg), restSeconds: e.restSeconds, notes: e.notes,
    })),
  };
}

function serialiseDiet(p: any) {
  return {
    id: p.id, memberId: p.memberId, trainerName: p.trainer?.user.displayName ?? null, name: p.name, startDate: ymd(p.startDate),
    dailyCalories: p.dailyCalories, proteinG: p.proteinG, carbsG: p.carbsG, fatG: p.fatG, preferences: p.preferences, allergies: p.allergies,
    notes: p.notes, isActive: p.isActive, updatedAt: p.updatedAt,
    meals: p.meals.map((m: any) => ({ mealTime: m.mealTime, label: m.label, items: m.items })),
  };
}

function serialiseMetric(r: any) {
  return {
    id: r.id, measuredOn: ymd(r.measuredOn),
    weightKg: r.weightGrams != null ? r.weightGrams / 1000 : null, heightCm: r.heightMm != null ? r.heightMm / 10 : null,
    bodyFatPct: r.bodyFatBp != null ? r.bodyFatBp / 100 : null, waistCm: r.waistMm != null ? r.waistMm / 10 : null,
    chestCm: r.chestMm != null ? r.chestMm / 10 : null, notes: r.notes,
  };
}

