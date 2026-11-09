-- =============================================================================
-- Gym CRM — database rules Prisma cannot express.
-- Apply as a custom migration right after the initial Prisma migration:
--   npx prisma migrate dev --create-only --name db_constraints
--   paste this file into the generated migration.sql, then: npx prisma migrate dev
-- Every statement is safe to read top-to-bottom; there are no data changes.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- -----------------------------------------------------------------------------
-- 1. Value checks
-- -----------------------------------------------------------------------------

ALTER TABLE "MembershipPlan"
  ADD CONSTRAINT plan_duration_positive  CHECK ("durationDays" > 0),
  ADD CONSTRAINT plan_price_nonneg       CHECK ("pricePaise" >= 0 AND "registrationFeePaise" >= 0),
  ADD CONSTRAINT plan_tax_range          CHECK ("taxRateBp" BETWEEN 0 AND 2800),
  ADD CONSTRAINT plan_freeze_consistent  CHECK ("freezeAllowed" OR ("maxFreezeDays" = 0 AND "maxFreezeCount" = 0));

ALTER TABLE "Subscription"
  ADD CONSTRAINT sub_dates_ordered CHECK ("endDate" >= "startDate" AND "originalEndDate" >= "startDate");

ALTER TABLE "SubscriptionFreeze"
  ADD CONSTRAINT freeze_dates_ordered CHECK ("endDate" >= "startDate");

ALTER TABLE "BranchClosure"
  ADD CONSTRAINT closure_dates_ordered CHECK ("endDate" >= "startDate");

ALTER TABLE "InvoiceItem"
  ADD CONSTRAINT item_qty_positive   CHECK ("quantity" > 0),
  ADD CONSTRAINT item_amounts_nonneg CHECK ("unitPricePaise" >= 0 AND "discountPaise" >= 0 AND "taxPaise" >= 0),
  ADD CONSTRAINT item_taxable_math   CHECK ("taxableValuePaise" = "quantity" * "unitPricePaise" - "discountPaise"),
  ADD CONSTRAINT item_total_math     CHECK ("totalPaise" = "taxableValuePaise" + "taxPaise");

ALTER TABLE "Invoice"
  ADD CONSTRAINT invoice_total_math CHECK (
    "totalPaise" = "subtotalPaise" - "discountPaise" + "cgstPaise" + "sgstPaise" + "igstPaise" + "roundOffPaise"),
  ADD CONSTRAINT invoice_gst_split  CHECK ("igstPaise" = 0 OR ("cgstPaise" = 0 AND "sgstPaise" = 0)),
  ADD CONSTRAINT invoice_number_when_issued CHECK ("status" = 'DRAFT' OR "invoiceNumber" IS NOT NULL);

ALTER TABLE "Payment"
  ADD CONSTRAINT payment_amount_positive CHECK ("amountPaise" > 0),
  ADD CONSTRAINT payment_unallocated_range CHECK ("unallocatedPaise" BETWEEN 0 AND "amountPaise"),
  ADD CONSTRAINT payment_gateway_ids CHECK ("method" <> 'GATEWAY' OR "gatewayOrderId" IS NOT NULL);

ALTER TABLE "PaymentAllocation" ADD CONSTRAINT alloc_amount_positive CHECK ("amountPaise" > 0);
ALTER TABLE "Refund"            ADD CONSTRAINT refund_amount_positive CHECK ("amountPaise" > 0);
ALTER TABLE "GatewayOrder"      ADD CONSTRAINT order_amount_positive CHECK ("amountPaise" > 0);
ALTER TABLE "Expense"           ADD CONSTRAINT expense_amount_nonneg CHECK ("amountPaise" >= 0 AND "gstPaise" >= 0);

ALTER TABLE "Coupon"
  ADD CONSTRAINT coupon_one_kind CHECK (("percentBp" IS NULL) <> ("flatPaise" IS NULL)),
  ADD CONSTRAINT coupon_dates    CHECK ("validUntil" >= "validFrom");

ALTER TABLE "MemberPtPackage"
  ADD CONSTRAINT pt_used_range CHECK ("sessionsUsed" BETWEEN 0 AND "sessionsTotal");

ALTER TABLE "PtSession"
  ADD CONSTRAINT pt_session_times CHECK ("scheduledEnd" > "scheduledStart");

ALTER TABLE "Attendance"
  ADD CONSTRAINT attendance_deny_reason CHECK (("result" = 'DENIED') = ("denyReason" IS NOT NULL) OR "overrideReason" IS NOT NULL),
  ADD CONSTRAINT attendance_checkout_after CHECK ("checkOutAt" IS NULL OR "checkOutAt" >= "checkInAt");

ALTER TABLE "BranchHours" ADD CONSTRAINT hours_dow CHECK ("dayOfWeek" BETWEEN 0 AND 6);

-- -----------------------------------------------------------------------------
-- 2. Partial / exclusion uniqueness
-- -----------------------------------------------------------------------------

-- Business-wide settings (branchId NULL) must also be unique per key.
CREATE UNIQUE INDEX branch_setting_global_key ON "BranchSetting" ("key") WHERE "branchId" IS NULL;

-- A member has at most one current trainer.
CREATE UNIQUE INDEX trainer_assignment_one_active ON "TrainerAssignment" ("memberId") WHERE "endedAt" IS NULL;

-- At most one current health declaration per member.
CREATE UNIQUE INDEX health_one_current ON "HealthDeclaration" ("memberId") WHERE "supersededAt" IS NULL;

-- Live subscriptions for one member cannot overlap in time (early renewals start after the current end date).
ALTER TABLE "Subscription" ADD CONSTRAINT sub_no_overlap EXCLUDE USING gist (
  "memberId" WITH =,
  daterange("startDate", "endDate", '[]') WITH &&
) WHERE ("status" IN ('SCHEDULED', 'ACTIVE', 'FROZEN'));

-- A trainer cannot be double-booked for PT.
ALTER TABLE "PtSession" ADD CONSTRAINT pt_trainer_no_overlap EXCLUDE USING gist (
  "trainerId" WITH =,
  tstzrange("scheduledStart", "scheduledEnd", '[)') WITH &&
) WHERE ("status" = 'SCHEDULED' OR "status" = 'COMPLETED');

-- Fast case-insensitive member search.
CREATE INDEX member_name_search ON "Member" (lower("firstName"), lower(coalesce("lastName", '')));

-- -----------------------------------------------------------------------------
-- 3. Money integrity
-- -----------------------------------------------------------------------------

-- Allocations can never exceed the payment, nor the invoice total.
CREATE OR REPLACE FUNCTION check_allocation_limits() RETURNS trigger AS $$
DECLARE
  pay_amount int; pay_status "PaymentStatus"; inv_total int; inv_status "InvoiceStatus";
  pay_alloc bigint; inv_alloc bigint;
BEGIN
  SELECT "amountPaise", "status" INTO pay_amount, pay_status FROM "Payment" WHERE id = NEW."paymentId" FOR UPDATE;
  SELECT "totalPaise", "status" INTO inv_total, inv_status FROM "Invoice" WHERE id = NEW."invoiceId" FOR UPDATE;
  IF pay_status <> 'CONFIRMED' THEN RAISE EXCEPTION 'cannot allocate an unconfirmed payment'; END IF;
  IF inv_status IN ('DRAFT', 'VOID') THEN RAISE EXCEPTION 'cannot allocate to a % invoice', inv_status; END IF;
  SELECT coalesce(sum("amountPaise"), 0) INTO pay_alloc FROM "PaymentAllocation" WHERE "paymentId" = NEW."paymentId";
  SELECT coalesce(sum("amountPaise"), 0) INTO inv_alloc FROM "PaymentAllocation" WHERE "invoiceId" = NEW."invoiceId";
  IF pay_alloc + NEW."amountPaise" > pay_amount THEN RAISE EXCEPTION 'allocation exceeds payment amount'; END IF;
  IF inv_alloc + NEW."amountPaise" > inv_total THEN RAISE EXCEPTION 'allocation exceeds invoice total'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER payment_allocation_limits BEFORE INSERT ON "PaymentAllocation"
  FOR EACH ROW EXECUTE FUNCTION check_allocation_limits();

-- Refunds (not rejected) can never exceed the payment.
CREATE OR REPLACE FUNCTION check_refund_limit() RETURNS trigger AS $$
DECLARE pay_amount int; refunded bigint;
BEGIN
  SELECT "amountPaise" INTO pay_amount FROM "Payment" WHERE id = NEW."paymentId" FOR UPDATE;
  SELECT coalesce(sum("amountPaise"), 0) INTO refunded FROM "Refund"
    WHERE "paymentId" = NEW."paymentId" AND "status" <> 'REJECTED' AND id <> NEW.id;
  IF NEW."status" <> 'REJECTED' AND refunded + NEW."amountPaise" > pay_amount THEN
    RAISE EXCEPTION 'refunds exceed payment amount';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER refund_limit BEFORE INSERT OR UPDATE OF "amountPaise", "status" ON "Refund"
  FOR EACH ROW EXECUTE FUNCTION check_refund_limit();

-- Ledger tables are append-only.
CREATE OR REPLACE FUNCTION forbid_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed (append-only)', TG_OP, TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER allocation_immutable BEFORE UPDATE OR DELETE ON "PaymentAllocation" FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER credit_note_immutable BEFORE UPDATE OR DELETE ON "CreditNote"       FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER audit_log_immutable  BEFORE UPDATE OR DELETE ON "AuditLog"          FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER consent_immutable    BEFORE UPDATE OR DELETE ON "ConsentRecord"     FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER payment_no_delete    BEFORE DELETE ON "Payment"                     FOR EACH ROW EXECUTE FUNCTION forbid_change();
CREATE TRIGGER invoice_no_delete    BEFORE DELETE ON "Invoice"                     FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- Payments: once CONFIRMED, only "unallocatedPaise" may change. PENDING -> CONFIRMED/FAILED is the only status move.
CREATE OR REPLACE FUNCTION guard_payment_update() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'PENDING' AND NEW."status" <> OLD."status" THEN
    RAISE EXCEPTION 'payment status % is final', OLD."status";
  END IF;
  IF OLD."status" = 'CONFIRMED' AND (
       NEW."amountPaise" <> OLD."amountPaise" OR NEW."method" <> OLD."method"
    OR NEW."memberId" <> OLD."memberId" OR NEW."branchId" <> OLD."branchId"
    OR NEW."receivedAt" <> OLD."receivedAt"
    OR NEW."gatewayPaymentId" IS DISTINCT FROM OLD."gatewayPaymentId") THEN
    RAISE EXCEPTION 'confirmed payment is immutable; record a refund instead';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER payment_guard BEFORE UPDATE ON "Payment" FOR EACH ROW EXECUTE FUNCTION guard_payment_update();

-- Invoices: amounts and lines are frozen once issued. Only status, pdf and void fields may change.
CREATE OR REPLACE FUNCTION guard_invoice_update() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'VOID' THEN RAISE EXCEPTION 'void invoice cannot change'; END IF;
  IF OLD."status" <> 'DRAFT' AND (
       NEW."subtotalPaise" <> OLD."subtotalPaise" OR NEW."discountPaise" <> OLD."discountPaise"
    OR NEW."cgstPaise" <> OLD."cgstPaise" OR NEW."sgstPaise" <> OLD."sgstPaise" OR NEW."igstPaise" <> OLD."igstPaise"
    OR NEW."totalPaise" <> OLD."totalPaise" OR NEW."memberId" <> OLD."memberId"
    OR NEW."invoiceNumber" IS DISTINCT FROM OLD."invoiceNumber" OR NEW."issueDate" IS DISTINCT FROM OLD."issueDate") THEN
    RAISE EXCEPTION 'issued invoice is immutable; issue a credit note instead';
  END IF;
  IF NEW."status" = 'DRAFT' AND OLD."status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'issued invoice cannot return to draft';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_guard BEFORE UPDATE ON "Invoice" FOR EACH ROW EXECUTE FUNCTION guard_invoice_update();

CREATE OR REPLACE FUNCTION guard_invoice_item() RETURNS trigger AS $$
DECLARE inv_status "InvoiceStatus";
BEGIN
  SELECT "status" INTO inv_status FROM "Invoice" WHERE id = coalesce(NEW."invoiceId", OLD."invoiceId");
  IF inv_status <> 'DRAFT' THEN RAISE EXCEPTION 'items of an issued invoice are immutable'; END IF;
  RETURN coalesce(NEW, OLD);
END $$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_item_guard BEFORE INSERT OR UPDATE OR DELETE ON "InvoiceItem"
  FOR EACH ROW EXECUTE FUNCTION guard_invoice_item();

-- Gap-free GST invoice numbers. Call inside the same transaction that issues the invoice:
--   SELECT next_invoice_number($branchId, '2026-27');
-- The row lock serialises concurrent issues per branch+FY; a rollback releases the number unused.
CREATE OR REPLACE FUNCTION next_invoice_number(p_branch uuid, p_fy varchar) RETURNS text AS $$
DECLARE n int; pfx text;
BEGIN
  UPDATE "InvoiceSequence" SET "nextNumber" = "nextNumber" + 1
   WHERE "branchId" = p_branch AND "financialYear" = p_fy
   RETURNING "nextNumber" - 1, "prefix" INTO n, pfx;
  IF n IS NULL THEN RAISE EXCEPTION 'no invoice sequence for branch % FY %', p_branch, p_fy; END IF;
  RETURN pfx || lpad(n::text, 5, '0');
END $$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- 4. Reporting helpers
-- -----------------------------------------------------------------------------

CREATE OR REPLACE VIEW invoice_balance WITH (security_invoker = true) AS
SELECT i.id AS "invoiceId", i."branchId", i."memberId", i."totalPaise",
       coalesce(sum(a."amountPaise"), 0)::int AS "paidPaise",
       i."totalPaise" - coalesce(sum(a."amountPaise"), 0)::int AS "duePaise"
FROM "Invoice" i
LEFT JOIN "PaymentAllocation" a ON a."invoiceId" = i.id
WHERE i."status" IN ('ISSUED', 'PARTIALLY_PAID', 'PAID')
GROUP BY i.id;

CREATE OR REPLACE VIEW stock_on_hand WITH (security_invoker = true) AS
SELECT "productId", "branchId", sum("quantity")::int AS "quantity"
FROM "StockMovement" GROUP BY "productId", "branchId";

-- Human-friendly running numbers (gaps are fine; GST invoice numbers use next_invoice_number instead).
CREATE SEQUENCE IF NOT EXISTS member_code_seq START 1001;
CREATE SEQUENCE IF NOT EXISTS receipt_no_seq START 1;

-- -----------------------------------------------------------------------------
-- 5. Branch row-level security (defence in depth behind the API's own checks)
--
-- The API runs every request in a transaction and first executes:
--   SELECT set_config('app.user_id', '<uuid>', true),
--          set_config('app.branch_ids', '<uuid>,<uuid>' | '*', true);
-- '*' = all branches (owner). Unset = no rows. Migrations/jobs use a role with BYPASSRLS.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_branch_allowed(b uuid) RETURNS boolean AS $$
  SELECT CASE
    WHEN coalesce(current_setting('app.branch_ids', true), '') = '' THEN false
    WHEN current_setting('app.branch_ids', true) = '*' THEN true
    ELSE b = ANY (string_to_array(current_setting('app.branch_ids', true), ',')::uuid[])
  END
$$ LANGUAGE sql STABLE;

DO $$
DECLARE t text; col text;
BEGIN
  FOR t, col IN VALUES
    ('Member', 'homeBranchId'), ('Lead', 'branchId'), ('Attendance', 'branchId'),
    ('Invoice', 'branchId'), ('Payment', 'branchId'), ('Expense', 'branchId'),
    ('Equipment', 'branchId'), ('StockMovement', 'branchId'), ('PtSession', 'branchId')
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY branch_scope ON %I USING (app_branch_allowed(%I)) WITH CHECK (app_branch_allowed(%I))', t, col, col);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 6. Database roles (run once per environment; passwords come from Secrets Manager)
-- -----------------------------------------------------------------------------
-- CREATE ROLE gym_app    LOGIN NOBYPASSRLS;           -- the API
-- CREATE ROLE gym_worker LOGIN BYPASSRLS;             -- background jobs (reminders, expiry), still org-wide only
-- CREATE ROLE gym_readonly LOGIN NOBYPASSRLS;         -- reporting replica
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gym_app;
-- REVOKE UPDATE, DELETE ON "AuditLog", "ConsentRecord", "PaymentAllocation", "CreditNote" FROM gym_app;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gym_app;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO gym_app;
