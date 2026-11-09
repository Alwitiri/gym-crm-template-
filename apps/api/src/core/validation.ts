import { PipeTransform } from "@nestjs/common";
import { z, ZodType } from "zod";
import { AppError } from "./errors";

/** `@Body(new Zod(schema))` — validates and strips unknown keys. */
export class Zod<T> implements PipeTransform {
  constructor(private readonly schema: ZodType<T>) {}
  transform(value: unknown): T {
    const r = this.schema.safeParse(value ?? {});
    if (r.success) return r.data;
    throw new AppError(400, "VALIDATION_FAILED", "Some fields are invalid", {
      errors: r.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
  }
}

export const zPhone = z.string().trim().regex(/^\+[1-9][0-9]{7,14}$/, "Use international format, e.g. +919876543210");
export const zUuid = z.string().uuid();
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
export const zPaise = z.number().int().min(0).max(100_000_000);
export const zPage = z.coerce.number().int().min(1).default(1);
export const zPageSize = z.coerce.number().int().min(1).max(100).default(25);

export const listQuery = z.object({
  page: zPage,
  pageSize: zPageSize,
  q: z.string().trim().min(2).max(100).optional(),
  branchId: zUuid.optional(),
});

/** Accepts "+91 98765 43210" / "98765 43210" and normalises Indian numbers to E.164. */
export function normalisePhone(input: string): string {
  const digits = input.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (/^[6-9]\d{9}$/.test(digits)) return "+91" + digits;
  if (/^0[6-9]\d{9}$/.test(digits)) return "+91" + digits.slice(1);
  if (/^91[6-9]\d{9}$/.test(digits)) return "+" + digits;
  return digits;
}

export const zPhoneLoose = z.string().transform(normalisePhone).pipe(zPhone);
