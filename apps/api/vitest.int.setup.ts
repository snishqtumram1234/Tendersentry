// Integration tests drive the real app over plain HTTP via supertest's in-process server (no TLS
// — same as local dev). Session cookies get the `Secure` flag whenever APP_ENV isn't "local"
// (apps/src/modules/auth/routes.ts cookieOpts), and a plain-HTTP client correctly refuses to store
// or resend a Secure cookie — exactly like a real browser would. Force APP_ENV=local for this
// cookie-flag purpose only; DATABASE_URL/DIRECT_URL and everything else still come from the real
// .env that `pnpm test:int` loads, so this still exercises the actual hosted database.
process.env.APP_ENV = "local";
