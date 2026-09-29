-- Set the runtime role password for this environment. Run as postgres over DIRECT_URL, e.g.:
--   psql "$DIRECT_URL" -v pw="'<strong-password>'" -f apps/api/prisma/sql/set-app-role-password.sql
-- Never commit the password. Local dev uses the value in .env.example (ts_app_local_only).
ALTER ROLE ts_app WITH PASSWORD :pw;
