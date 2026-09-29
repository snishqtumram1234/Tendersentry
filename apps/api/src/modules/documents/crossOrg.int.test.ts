// Integration test against the real hosted database (spec §23.2): tenancy isolation and
// permission enforcement, driven through the actual HTTP app — not just unit-testing the
// middleware in isolation, so this proves the whole stack (session, CSRF, RBAC, repository scope)
// works together the way §6.3/§6.5 require.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { createApp } from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import { hashPassword } from "../../lib/crypto.js";
import { deleteObject } from "../../lib/storage.js";

const app = createApp();
const DEMO_OTP = process.env.DEMO_OTP ?? "000000";
const suffix = randomUUID().slice(0, 8);

interface TestUser {
  email: string;
  userId: string;
  agent: ReturnType<typeof request.agent>;
  csrf: string;
}

async function createTestOrgAndUser(label: string, role: "BUYER" | "TECHNICAL_EVALUATOR"): Promise<{ orgId: string; user: TestUser }> {
  const org = await prisma.organisation.create({
    data: { code: `TEST-XORG-${label}-${suffix}`, type: "GOVERNMENT", legalName: `Test Org ${label} ${suffix}`, displayName: `Test Org ${label}` },
  });
  const email = `xorg-${label.toLowerCase()}-${suffix}@test.local`;
  const user = await prisma.user.create({
    data: { email, name: `Test User ${label}`, portalType: "GOVERNMENT", passwordHash: await hashPassword("Test@Pass1234"), status: "ACTIVE", isDemo: true, emailVerified: true },
  });
  await prisma.membership.create({ data: { userId: user.id, organisationId: org.id, status: "ACTIVE" } });
  await prisma.userRole.create({ data: { userId: user.id, organisationId: org.id, role } });

  const agent = request.agent(app);
  const loginRes = await agent.post("/api/v1/auth/government/login").send({ identifier: email, password: "Test@Pass1234" });
  expect(loginRes.body.status).toBe("MFA_ENROLLMENT_REQUIRED");
  const mfaRes = await agent.post("/api/v1/auth/mfa/verify").send({ challenge: loginRes.body.challenge, code: DEMO_OTP });
  expect(mfaRes.body.status).toBe("SESSION");

  const csrfCookie = (mfaRes.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("ts_csrf="));
  const csrf = csrfCookie!.split(";")[0]!.split("=")[1]!;

  return { orgId: org.id, user: { email, userId: user.id, agent, csrf } };
}

async function cleanupUser(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.userRole.deleteMany({ where: { userId } });
  await prisma.membership.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
}

describe("tenancy isolation and permission enforcement (spec §6.3, §6.5)", () => {
  let orgA: { orgId: string; user: TestUser };
  let orgB: { orgId: string; user: TestUser };
  let evaluatorOnlyInOrgA: { orgId: string; user: TestUser };
  let documentId: string;

  beforeAll(async () => {
    orgA = await createTestOrgAndUser("A", "BUYER");
    orgB = await createTestOrgAndUser("B", "BUYER");
    // TECHNICAL_EVALUATOR is not in the audit.read allow-list (spec §6.3) — used for the 403 test.
    evaluatorOnlyInOrgA = await createTestOrgAndUser("C", "TECHNICAL_EVALUATOR");
  }, 30_000);

  afterAll(async () => {
    if (documentId) {
      const doc = await prisma.document.findUnique({ where: { id: documentId } });
      await prisma.document.deleteMany({ where: { id: documentId } });
      if (doc) await deleteObject(doc.storageBucket, doc.storageKey).catch(() => undefined);
    }
    await cleanupUser(orgA.user.userId);
    await cleanupUser(orgB.user.userId);
    await cleanupUser(evaluatorOnlyInOrgA.user.userId);
    await prisma.organisation.delete({ where: { id: orgA.orgId } });
    await prisma.organisation.delete({ where: { id: orgB.orgId } });
    await prisma.organisation.delete({ where: { id: evaluatorOnlyInOrgA.orgId } });
  }, 30_000);

  it("org A can upload a document and read it back", async () => {
    const res = await orgA.user.agent
      .post("/api/v1/documents")
      .set("x-csrf-token", orgA.user.csrf)
      .attach("file", Buffer.from("%PDF-1.4\ncross-org test\n%%EOF"), "cross-org-test.pdf");
    expect(res.status).toBe(201);
    documentId = res.body.documentId;

    const meta = await orgA.user.agent.get(`/api/v1/documents/${documentId}`);
    expect(meta.status).toBe(200);
    expect(meta.body.originalFilename).toBe("cross-org-test.pdf");
  });

  it("org B cannot read org A's document — 404, not 403 (spec §6.3: do not leak existence)", async () => {
    const res = await orgB.user.agent.get(`/api/v1/documents/${documentId}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("org B cannot get a signed URL for org A's document", async () => {
    const res = await orgB.user.agent.get(`/api/v1/documents/${documentId}/url`);
    expect(res.status).toBe(404);
  });

  it("an unauthenticated request is rejected before any tenancy check runs", async () => {
    const res = await request(app).get(`/api/v1/documents/${documentId}`);
    expect(res.status).toBe(401);
  });

  it("a role without audit.read is denied with 403, not a silent empty result", async () => {
    const res = await evaluatorOnlyInOrgA.user.agent.get("/api/v1/audit/verify-chain");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("a role WITH audit.read (BUYER) can reach the same endpoint", async () => {
    const res = await orgA.user.agent.get("/api/v1/audit/verify-chain");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("a mutating request without the CSRF header is rejected (spec §6.4)", async () => {
    const res = await orgA.user.agent.post("/api/v1/auth/logout"); // no x-csrf-token set
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CSRF_INVALID");
  });

  it("re-uploading the identical bytes to the SAME org is deduped, not duplicated", async () => {
    const res = await orgA.user.agent
      .post("/api/v1/documents")
      .set("x-csrf-token", orgA.user.csrf)
      .attach("file", Buffer.from("%PDF-1.4\ncross-org test\n%%EOF"), "cross-org-test.pdf");
    expect(res.status).toBe(201);
    expect(res.body.documentId).toBe(documentId);
    expect(res.body.duplicate).toBe(true);
  });
});
