// Minimal deterministic seed for Phase 0 (spec §22.1 subset): one organisation + one user per
// portal, enough to exercise the full login flow end-to-end. Refuses to run in production.
import { prisma } from "../lib/prisma.js";
import { hashPassword } from "../lib/crypto.js";
import { config } from "../config.js";

const DEMO_PASSWORD = "Demo@TenderSentry2026";

async function upsertOrg(code: string, type: "GOVERNMENT" | "BIDDER" | "PLATFORM", legalName: string, displayName: string) {
  return prisma.organisation.upsert({
    where: { code },
    create: { code, type, legalName, displayName },
    update: { legalName, displayName },
  });
}

async function upsertUser(email: string, name: string, portalType: "GOVERNMENT" | "BIDDER" | "PLATFORM") {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  return prisma.user.upsert({
    where: { email },
    create: { email, name, portalType, passwordHash, status: "ACTIVE", isDemo: true, emailVerified: true },
    update: { name, passwordHash, status: "ACTIVE", isDemo: true },
  });
}

async function ensureMembership(userId: string, organisationId: string) {
  await prisma.membership.upsert({
    where: { userId_organisationId: { userId, organisationId } },
    create: { userId, organisationId, status: "ACTIVE" },
    update: { status: "ACTIVE" },
  });
}

async function ensureRole(userId: string, organisationId: string, role: "ORG_ADMIN" | "BUYER" | "BIDDER_ADMIN" | "SYSTEM_ADMIN") {
  await prisma.userRole.upsert({
    where: { userId_organisationId_role: { userId, organisationId, role } },
    create: { userId, organisationId, role },
    update: {},
  });
}

async function main() {
  if (config.APP_ENV === "production") {
    console.error("Refusing to seed: APP_ENV=production.");
    process.exit(1);
  }

  console.log(`Seeding against ${config.APP_ENV} (demo password for all seeded users: ${DEMO_PASSWORD})`);

  const govOrg = await upsertOrg("DEMO-GOV-001", "GOVERNMENT", "Department of Public Works (Demo)", "Department of Public Works (Demo)");
  const bidderOrg = await upsertOrg("DEMO-BID-001", "BIDDER", "ABC Engineering Pvt Ltd (Demo)", "ABC Engineering (Demo)");
  const platformOrg = await upsertOrg("DEMO-PLATFORM", "PLATFORM", "TenderSentry Platform", "TenderSentry Platform");

  const buyer = await upsertUser("buyer@demo.gov.test", "Buyer Officer", "GOVERNMENT");
  await ensureMembership(buyer.id, govOrg.id);
  await ensureRole(buyer.id, govOrg.id, "ORG_ADMIN");
  await ensureRole(buyer.id, govOrg.id, "BUYER");

  const bidderAdmin = await upsertUser("admin@abc-demo.test", "ABC Bidder Admin", "BIDDER");
  await ensureMembership(bidderAdmin.id, bidderOrg.id);
  await ensureRole(bidderAdmin.id, bidderOrg.id, "BIDDER_ADMIN");

  const sysAdmin = await upsertUser("admin@tendersentry.test", "System Administrator", "PLATFORM");
  await ensureMembership(sysAdmin.id, platformOrg.id);
  await ensureRole(sysAdmin.id, platformOrg.id, "SYSTEM_ADMIN");

  console.log("Seed complete:");
  console.log(`  government: buyer@demo.gov.test / ${DEMO_PASSWORD} (MFA enrolment on first login)`);
  console.log(`  bidder:     admin@abc-demo.test / ${DEMO_PASSWORD} (MFA enrolment on first login)`);
  console.log(`  admin:      admin@tendersentry.test / ${DEMO_PASSWORD} (MFA enrolment on first login)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
