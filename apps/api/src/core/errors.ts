import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import type { Request, Response } from "express";

/** Error with a stable machine-readable code, rendered as RFC 9457 problem details. */
export class AppError extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message, status);
  }
}

export const notFound = (what = "Resource") => new AppError(404, "NOT_FOUND", `${what} not found`);
export const forbidden = (msg = "You do not have permission for this action") => new AppError(403, "FORBIDDEN", msg);
export const conflict = (code: string, msg: string, extra?: Record<string, unknown>) => new AppError(409, code, msg, extra);
export const unprocessable = (code: string, msg: string, extra?: Record<string, unknown>) => new AppError(422, code, msg, extra);

const titles: Record<number, string> = {
  400: "Bad request", 401: "Unauthorized", 403: "Forbidden", 404: "Not found", 409: "Conflict",
  412: "Precondition failed", 422: "Unprocessable", 423: "Locked", 429: "Too many requests", 500: "Internal error",
};

/** Maps database-rule violations (constraints.sql) to friendly API errors. */
function fromDatabase(err: any): AppError | null {
  const text = `${err?.message ?? ""} ${JSON.stringify(err?.meta ?? {})}`;
  if (err?.code === "P2002") return conflict("ALREADY_EXISTS", "A record with these details already exists", { target: err.meta?.target });
  if (err?.code === "P2025") return notFound();
  if (text.includes("pt_trainer_no_overlap")) return conflict("TRAINER_UNAVAILABLE", "The trainer already has a session at that time");
  if (text.includes("sub_no_overlap")) return conflict("SUBSCRIPTION_OVERLAP", "This member already has a membership for those dates");
  if (text.includes("allocation exceeds")) return unprocessable("ALLOCATION_TOO_LARGE", "Amount is more than what is due or available");
  if (text.includes("refunds exceed")) return unprocessable("REFUND_TOO_LARGE", "Refunds would exceed the payment");
  if (text.includes("immutable") || text.includes("append-only")) return conflict("RECORD_LOCKED", "This financial record can no longer be changed");
  if (text.includes("violates check constraint")) return unprocessable("INVALID_VALUES", "Some values are not allowed");
  if (text.includes("row-level security")) return notFound();
  return null;
}

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly log = new Logger("Error");

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { requestId?: string }>();

    let err: AppError;
    if (exception instanceof AppError) err = exception;
    else if (exception instanceof HttpException) {
      const status = exception.getStatus();
      err = new AppError(status, status === 404 ? "NOT_FOUND" : "HTTP_" + status, exception.message);
    } else {
      err = fromDatabase(exception) ?? new AppError(500, "INTERNAL", "Something went wrong");
      if (err.getStatus() === 500) this.log.error(exception instanceof Error ? exception.stack : String(exception));
    }

    const status = err.getStatus();
    res
      .status(status)
      .type("application/problem+json")
      .json({
        type: `about:blank`,
        title: titles[status] ?? "Error",
        status,
        code: err.code,
        detail: err.message, // never a stack trace
        requestId: req.requestId,
        ...err.extra,
      });
  }
}
