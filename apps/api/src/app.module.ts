import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { AuditService } from "./core/audit.service";
import { AuthGuard, SessionService } from "./core/auth";
import { Db } from "./core/db.service";
import { ProblemFilter } from "./core/errors";
import { Idempotency } from "./core/idempotency.service";
import { AuthController } from "./modules/auth.controller";
import { BillingService } from "./modules/billing.service";
import { CatalogController } from "./modules/catalog.controller";
import { DashboardController } from "./modules/dashboard.controller";
import { JobsService } from "./modules/jobs.service";
import { LeadsController } from "./modules/leads.controller";
import { MembersController } from "./modules/members.controller";
import { PaymentsController } from "./modules/payments.controller";
import { HealthController } from "./modules/health.controller";
import { AttendanceController } from "./modules/attendance.controller";
import { FreezeController } from "./modules/freeze.controller";
import { TrainingController } from "./modules/training.controller";
import { PtController } from "./modules/pt.controller";
import { BootstrapService } from "./modules/bootstrap.service";
import { AdminController } from "./modules/admin.controller";
import { ImportController } from "./modules/import.controller";
import { FinanceController } from "./modules/finance.controller";
import { SettingsService } from "./core/settings.service";
import { MessagingService } from "./modules/messaging.service";
import { OnlineController, OnlinePayments } from "./modules/online.controller";
import { MessagesController } from "./modules/messages.controller";
import { PortalController } from "./modules/portal.controller";

@Module({
  controllers: [HealthController, AuthController, CatalogController, MembersController, PaymentsController, LeadsController, DashboardController,
    AttendanceController, FreezeController, TrainingController, PtController, AdminController, ImportController, FinanceController, OnlineController, MessagesController, PortalController],
  providers: [
    Db, AuditService, SessionService, Idempotency, BillingService, JobsService, BootstrapService, SettingsService, MessagingService, OnlinePayments,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: ProblemFilter },
  ],
})
export class AppModule {}
