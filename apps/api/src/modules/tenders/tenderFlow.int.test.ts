// End-to-end regression test for the Phase 2 rule workflow (spec §11, §12, §21.2, §27.1), driven
// through the real HTTP app, the real engine, and the real hosted database — exactly the flow that
// was manually verified while building this and that caught two real bugs:
//  1. Requirement.mandatory/weight/envelope/category never synced from an approved rule's DSL,
//     so the public eligibility page showed stale (always-false) mandatory flags.
//  2. (Documented in reconciliation.int.test.ts, Phase 1) — unrelated to this file but same
//     lesson: manual end-to-end testing found what unit tests alone did not.
//
// Requires the engine reachable at ENGINE_URL — skips cleanly otherwise (see reconciliation.int.test.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { createApp } from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import { hashPassword } from "../../lib/crypto.js";
import { config } from "../../config.js";

const app = createApp();
const DEMO_OTP = process.env.DEMO_OTP ?? "000000";
const suffix = randomUUID().slice(0, 8);

async function engineIsReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${config.ENGINE_URL}/engine/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

function tenderPdf(): Buffer {
  const content = [
    "BT /F1 12 Tf 72 720 Td (7.1 Eligibility) Tj ET",
    "BT /F1 12 Tf 72 700 Td (The bidder shall submit a valid GST registration certificate.) Tj ET",
  ].join("\n");
  const objects = [
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>endobj",
    "4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj",
    `5 0 obj<</Length ${content.length}>>stream\n${content}\nendstream endobj`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += obj + "\n";
  }
  const xrefStart = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${off.toString().padStart(10, "0")} 00000 n \n`;
  pdf += `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

describe.runIf(await engineIsReachable())("tender → clause → rule → publish (spec §11, §12, §27.1 Phase 2)", () => {
  let userId: string;
  let agent: ReturnType<typeof request.agent>;
  let csrf: string;
  let tenderId: string;
  let publicId: string;
  let documentId: string;

  beforeAll(async () => {
    const org = await prisma.organisation.create({
      data: { code: `TEST-TENDER-${suffix}`, type: "GOVERNMENT", legalName: `Test Tender Org ${suffix}`, displayName: "Test Tender Org" },
    });
    const email = `tenderflow-${suffix}@test.local`;
    const user = await prisma.user.create({
      data: { email, name: "Tender Flow Tester", portalType: "GOVERNMENT", passwordHash: await hashPassword("Test@Pass1234"), status: "ACTIVE", isDemo: true, emailVerified: true },
    });
    userId = user.id;
    await prisma.membership.create({ data: { userId: user.id, organisationId: org.id, status: "ACTIVE" } });
    await prisma.userRole.create({ data: { userId: user.id, organisationId: org.id, role: "BUYER" } });
    await prisma.userRole.create({ data: { userId: user.id, organisationId: org.id, role: "APPROVING_AUTHORITY" } });

    agent = request.agent(app);
    const loginRes = await agent.post("/api/v1/auth/government/login").send({ identifier: email, password: "Test@Pass1234" });
    const mfaRes = await agent.post("/api/v1/auth/mfa/verify").send({ challenge: loginRes.body.challenge, code: DEMO_OTP });
    expect(mfaRes.body.status).toBe("SESSION");
    csrf = (mfaRes.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("ts_csrf="))!.split(";")[0]!.split("=")[1]!;
  }, 30_000);

  afterAll(async () => {
    // Deliberately does NOT delete the tender/document once the tender is published: doing so
    // is only "cleanup" in the DRAFT case (see the last test, which cleans up its own draft-only
    // tender directly). A published tender writes a `tender_versions` row, which `ts_app` has only
    // INSERT/SELECT on — never UPDATE/DELETE (spec §7.0, ADR-003: append-only, same as
    // audit_events/bid_versions/overrides). Deleting the parent Tender would then also fail on the
    // still-referencing TenderVersion row's FK. That's correct, permanent-history behaviour, not a
    // bug — so this leaves the published tender in place, same as the Phase 1 test documents.
    // The organisation stays too (Tender.organisationId is a real FK to it), but the user account
    // itself has no enforced FK from any tender/rule row (createdBy/approvedBy are plain UUID
    // columns, not relations — deliberately, so historical records survive a deleted user), so it
    // can still be cleaned up.
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.userRole.deleteMany({ where: { userId } });
    await prisma.membership.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  }, 30_000);

  it("creates a tender, uploads+attaches a document, and analyzes it into a candidate rule", async () => {
    const tenderRes = await agent.post("/api/v1/tenders").set("x-csrf-token", csrf).send({ title: "Integration test tender", procurementMode: "SINGLE_ENVELOPE" });
    expect(tenderRes.status).toBe(201);
    tenderId = tenderRes.body.id;
    expect(tenderRes.body.state).toBe("DRAFT");

    const uploadRes = await agent.post("/api/v1/documents").set("x-csrf-token", csrf).attach("file", tenderPdf(), "tender.pdf");
    expect(uploadRes.status).toBe(201);
    documentId = uploadRes.body.documentId;

    const attachRes = await agent.post(`/api/v1/tenders/${tenderId}/documents`).set("x-csrf-token", csrf).send({ documentId, role: "MAIN" });
    expect(attachRes.status).toBe(201);

    const analyzeRes = await agent.post(`/api/v1/tenders/${tenderId}/analyze`).set("x-csrf-token", csrf);
    expect(analyzeRes.status).toBe(200);
    expect(analyzeRes.body.requirementCount).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it("a candidate rule with no LLM key lands as an empty manual-authoring slot, not a fabricated result", async () => {
    const rulesRes = await agent.get(`/api/v1/tenders/${tenderId}/rules`);
    expect(rulesRes.status).toBe(200);
    expect(rulesRes.body.items.length).toBeGreaterThanOrEqual(1);
    const rule = rulesRes.body.items[0];
    // MODEL_PROVIDER_KEY is unset in this environment's .env — the honest AI_UNAVAILABLE path.
    expect(rule.currentVersion.dsl).toBeNull();
    expect(rule.currentVersion.status).toBe("REVIEW_REQUIRED");
    expect(rule.currentVersion.origin).toBe("OFFICER_AUTHORED");
  });

  it("rejects approval of a rule with no content and no resolved ambiguities", async () => {
    const rulesRes = await agent.get(`/api/v1/tenders/${tenderId}/rules`);
    const ruleVersionId = rulesRes.body.items[0].currentVersion.id;
    const res = await agent.post(`/api/v1/rule-versions/${ruleVersionId}/approve`).set("x-csrf-token", csrf);
    expect(res.status).toBe(400);
    expect(res.body.error.details.errors.length).toBeGreaterThan(0);
  });

  it("manually authoring a valid DSL, approving it, and publishing works end to end — and syncs Requirement.mandatory/weight from the approved DSL", async () => {
    const rulesRes = await agent.get(`/api/v1/tenders/${tenderId}/rules`);
    const rule = rulesRes.body.items[0];
    const beforeReq = rule.requirement;
    expect(beforeReq.mandatory).toBe(false); // default at creation time, before any content exists

    const dsl = {
      schema_version: "1.0",
      rule_code: rule.code,
      name: "Valid GST registration",
      requirement_category: "STATUTORY",
      mandatory: true,
      weight: 25,
      envelope: "TECHNICAL",
      on_missing_evidence: "FAIL",
      evidence_types: ["GST_CERTIFICATE"],
      expression: { node: "DOCUMENT_EXISTS", doc_type: "GST_CERTIFICATE", min_count: 1 },
      plain_english: "client placeholder — must be overwritten server-side",
      source: { document_id: documentId, clause_ref: "7.1", page: 1 },
    };

    const editRes = await agent.post(`/api/v1/rules/${rule.ruleId}/versions`).set("x-csrf-token", csrf).send({ dsl });
    expect(editRes.status).toBe(201);
    expect(editRes.body.validationErrors).toEqual([]);
    // The server always regenerates plain_english deterministically — never trusts the client's.
    expect(editRes.body.plainEnglish).not.toContain("placeholder");
    expect(editRes.body.plainEnglish).toContain("Gst Certificate");

    const approveRes = await agent.post(`/api/v1/rule-versions/${editRes.body.id}/approve`).set("x-csrf-token", csrf);
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.status).toBe("APPROVED"); // not ACTIVE yet — tender still in DRAFT
    expect(approveRes.body.approvedBy).toBeTruthy();

    // Regression check for the sync bug: Requirement must now reflect the approved DSL.
    const reqRes = await agent.get(`/api/v1/tenders/${tenderId}/requirements`);
    const afterReq = reqRes.body.items.find((r: { id: string }) => r.id === beforeReq.id);
    expect(afterReq.mandatory).toBe(true);
    expect(afterReq.weight).toBe("25");
    expect(afterReq.category).toBe("STATUTORY");

    const validateRes = await agent.post(`/api/v1/tenders/${tenderId}/validate`);
    expect(validateRes.body.valid).toBe(true);

    const publishRes = await agent.post(`/api/v1/tenders/${tenderId}/publish`).set("x-csrf-token", csrf);
    expect(publishRes.status).toBe(200);
    expect(publishRes.body.state).toBe("PUBLISHED");
    publicId = publishRes.body.publicId;

    // Approving after publish would go straight to ACTIVE; approving BEFORE publish (this case)
    // only reaches ACTIVE once the tender is published — confirm that happened.
    const ruleAfterPublish = await prisma.ruleVersion.findUnique({ where: { id: editRes.body.id } });
    expect(ruleAfterPublish?.status).toBe("ACTIVE");
  }, 30_000);

  it("a second publish attempt is rejected (idempotency guard)", async () => {
    const res = await agent.post(`/api/v1/tenders/${tenderId}/publish`).set("x-csrf-token", csrf);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_STATE_TRANSITION");
  });

  it("the public tender page shows the correct, synced eligibility (no auth required)", async () => {
    const res = await request(app).get(`/api/v1/public/tenders/${publicId}`);
    expect(res.status).toBe(200);
    expect(res.body.eligibility).toHaveLength(1);
    expect(res.body.eligibility[0].mandatory).toBe(true);
    expect(res.body.eligibility[0].plainEnglish).toContain("Gst Certificate");
  });

  it("a DRAFT tender (not yet published) never appears on the public list", async () => {
    const draftRes = await agent.post("/api/v1/tenders").set("x-csrf-token", csrf).send({ title: "Should not be public", procurementMode: "SINGLE_ENVELOPE" });
    const listRes = await request(app).get("/api/v1/public/tenders");
    expect(listRes.body.items.some((t: { title: string }) => t.title === "Should not be public")).toBe(false);
    await prisma.tender.delete({ where: { id: draftRes.body.id } });
  });
});
