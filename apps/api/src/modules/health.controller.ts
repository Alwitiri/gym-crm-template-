import { Controller, Get } from "@nestjs/common";
import { Public } from "../core/auth";
import { Db } from "../core/db.service";

@Controller("health")
export class HealthController {
  constructor(private readonly db: Db) {}

  @Public()
  @Get()
  async health() {
    await this.db.raw.$queryRaw`SELECT 1`;
    return { ok: true };
  }
}
