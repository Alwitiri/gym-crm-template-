-- Run once per environment as a superuser, after the first migration.
-- Replace the passwords (or use IAM auth on RDS).
CREATE ROLE gym_app LOGIN PASSWORD 'change-me' NOSUPERUSER NOBYPASSRLS;
GRANT CONNECT ON DATABASE gymcrm TO gym_app;
GRANT USAGE ON SCHEMA public TO gym_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO gym_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO gym_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO gym_app;
REVOKE UPDATE, DELETE ON "AuditLog", "ConsentRecord", "PaymentAllocation", "CreditNote" FROM gym_app;
-- Tables added by later migrations: run the GRANT lines again, or
ALTER DEFAULT PRIVILEGES FOR ROLE gym_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gym_app;
ALTER DEFAULT PRIVILEGES FOR ROLE gym_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO gym_app;
