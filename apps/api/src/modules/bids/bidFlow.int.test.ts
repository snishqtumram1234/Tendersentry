// End-to-end regression test for the Phase 3 bidder workflow (spec §6.4, §13.4, §13.5, §15.9,
// §27.1): register a bidder → upload evidence to the vault → check readiness against a real
// published tender → create a bid → attach documents → pre-check → submit with a real manifest
// hash. This is the flow that caught a real bug while building it: the bid-creation route
// silently received `undefined` for `:tenderId` because the sub-router mounted at
// `/bidder/tenders/:tenderId/bids` wasn't created with `{ mergeParams: true }` — Prisma correctly
// rejected the resulting malformed query rather than doing something unpredictable, but the route
// itself was broken. Locked in here so it can't regress silently.
//
// Requires the engine reachable at ENGINE_URL — skips cleanly otherwise (see
// modules/documents/reconciliation.int.test.ts for the pattern).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID, createHash } from "node:crypto";
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

function makePdf(...lines: string[]): Buffer {
  const content = lines.map((l, i) => `BT /F1 12 Tf 72 ${700 - i * 20} Td (${l}) Tj ET`).join("\n");
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

async function waitForProcessing(agent: ReturnType<typeof request.agent>, documentId: string, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    const res = await agent.get(`/api/v1/documents/${documentId}`);
    const status = res.body.processingStatus as string;
    if (status === "EXTRACTED" || status === "FAILED" || status === "REVIEW_REQUIRED") return;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for document ${documentId} (last status: ${status})`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

describe.runIf(await engineIsReachable())("bidder registration → vault → readiness → bid → submit (spec §6.4, §13, §15.9, §27.1 Phase 3)", () => {
  // Government side: a minimal published tender to bid against.
  let govUserId: string;
  let govAgent: ReturnType<typeof request.agent>;
  let govCsrf: string;
  let tenderId: string;
  let tenderDocumentId: string;

  // Bidder side.
  let bidderOrgId: string;
  let bidderUserId: string;
  let bidderAgent: ReturnType<typeof request.agent>;
  let bidderCsrf: string;
  let vaultDocumentId: string;

  beforeAll(async () => {
    const govOrg = await prisma.organisation.create({
      data: { code: `TEST-BIDFLOW-GOV-${suffix}`, type: "GOVERNMENT", legalName: `Test BidFlow Gov ${suffix}`, displayName: "Test BidFlow Gov" },
    });
    const govEmail = `bidflow-gov-${suffix}@test.local`;
    const govUser = await prisma.user.create({
      data: { email: govEmail, name: "BidFlow Gov Tester", portalType: "GOVERNMENT", passwordHash: await hashPassword("Test@Pass1234"), status: "ACTIVE", isDemo: true, emailVerified: true },
    });
    govUserId = govUser.id;
    await prisma.membership.create({ data: { userId: govUser.id, organisationId: govOrg.id, status: "ACTIVE" } });
    await prisma.userRole.create({ data: { userId: govUser.id, organisationId: govOrg.id, role: "BUYER" } });

    govAgent = request.agent(app);
    const govLogin = await govAgent.post("/api/v1/auth/government/login").send({ identifier: govEmail, password: "Test@Pass1234" });
    const govMfa = await govAgent.post("/api/v1/auth/mfa/verify").send({ challenge: govLogin.body.challenge, code: DEMO_OTP });
    govCsrf = (govMfa.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("ts_csrf="))!.split(";")[0]!.split("=")[1]!;

    // Build and publish a one-requirement tender.
    const tenderRes = await govAgent.post("/api/v1/tenders").set("x-csrf-token", govCsrf).send({ title: "BidFlow test tender", procurementMode: "SINGLE_ENVELOPE" });
    tenderId = tenderRes.body.id;
    const uploadRes = await govAgent
      .post("/api/v1/documents")
      .set("x-csrf-token", govCsrf)
      .attach("file", makePdf("7.1 Eligibility", "The bidder shall submit a valid GST registration certificate."), "tender.pdf");
    tenderDocumentId = uploadRes.body.documentId;
    await govAgent.post(`/api/v1/tenders/${tenderId}/documents`).set("x-csrf-token", govCsrf).send({ documentId: tenderDocumentId, role: "MAIN" });
    await govAgent.post(`/api/v1/tenders/${tenderId}/analyze`).set("x-csrf-token", govCsrf);

    const rulesRes = await govAgent.get(`/api/v1/tenders/${tenderId}/rules`);
    const rule = rulesRes.body.items[0];
    const dsl = {
      schema_version: "1.0",
      rule_code: rule.code,
      name: "Valid GST registration",
      requirement_category: "STATUTORY",
      mandatory: true,
      envelope: "TECHNICAL",
      on_missing_evidence: "FAIL",
      evidence_types: ["GST_CERTIFICATE"],
      expression: { node: "DOCUMENT_EXISTS", doc_type: "GST_CERTIFICATE", min_count: 1 },
      plain_english: "placeholder",
      source: { document_id: tenderDocumentId, clause_ref: "7.1", page: 1 },
    };
    const editRes = await govAgent.post(`/api/v1/rules/${rule.ruleId}/versions`).set("x-csrf-token", govCsrf).send({ dsl });
    await govAgent.post(`/api/v1/rule-versions/${editRes.body.id}/approve`).set("x-csrf-token", govCsrf);
    const publishRes = await govAgent.post(`/api/v1/tenders/${tenderId}/publish`).set("x-csrf-token", govCsrf);
    expect(publishRes.status).toBe(200);

    // Bidder side: real self-registration (spec §6.4), not a seeded/demo account.
    const bidderEmail = `bidflow-bidder-${suffix}@test.local`;
    const registerRes = await request(app).post("/api/v1/auth/register/bidder").send({
      email: bidderEmail,
      password: "Test@BidderPass1234",
      contactName: "BidFlow Bidder Tester",
      legalName: `BidFlow Test Bidder ${suffix}`,
      orgSubtype: "Pvt Ltd",
    });
    expect(registerRes.status).toBe(201);
    bidderOrgId = registerRes.body.organisationId;
    bidderUserId = registerRes.body.userId;

    bidderAgent = request.agent(app);
    const bidderLogin = await bidderAgent.post("/api/v1/auth/bidder/login").send({ identifier: bidderEmail, password: "Test@BidderPass1234" });
    expect(bidderLogin.body.status).toBe("MFA_ENROLLMENT_REQUIRED");
    // A freshly self-registered account is real, not demo — verify the actual TOTP secret works
    // end to end rather than relying on the demo-OTP bypass (spec §6.4).
    const { generate } = await import("otplib");
    const secret = bidderLogin.body.otpauthUrl.match(/secret=([A-Z0-9]+)/)![1];
    const code = await generate({ secret });
    const bidderMfa = await bidderAgent.post("/api/v1/auth/mfa/verify").send({ challenge: bidderLogin.body.challenge, code });
    expect(bidderMfa.body.status).toBe("SESSION");
    bidderCsrf = (bidderMfa.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("ts_csrf="))!.split(";")[0]!.split("=")[1]!;
  }, 40_000);

  afterAll(async () => {
    // Same append-only/FK reasoning as tenderFlow.int.test.ts: a published tender's history
    // can't (and shouldn't) be deleted by ts_app. Clean up what's genuinely safe to remove.
    await prisma.session.deleteMany({ where: { userId: { in: [govUserId, bidderUserId] } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: [govUserId, bidderUserId] } } });
    await prisma.membership.deleteMany({ where: { userId: { in: [govUserId, bidderUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [govUserId, bidderUserId] } } });
  }, 30_000);

  it("uploads evidence to the vault and it gets classified and reused, not duplicated", async () => {
    const uploadRes = await bidderAgent
      .post("/api/v1/bidder/vault")
      .set("x-csrf-token", bidderCsrf)
      .field("evidenceType", "GST_CERTIFICATE")
      .attach("file", makePdf("FORM GST REG-06", "Registration Certificate", "GSTIN: 27AAPFU0939F1ZV"), "gst.pdf");
    expect(uploadRes.status).toBe(201);
    vaultDocumentId = uploadRes.body.documentId;
    await waitForProcessing(bidderAgent, vaultDocumentId);

    const listRes = await bidderAgent.get("/api/v1/bidder/vault");
    expect(listRes.body.items).toHaveLength(1);
    expect(listRes.body.items[0].document.docType).toBe("GST_CERTIFICATE"); // classified, matches declared type

    // Re-uploading the identical bytes reuses the vault item (spec §13.4), doesn't duplicate it.
    const reuploadRes = await bidderAgent
      .post("/api/v1/bidder/vault")
      .set("x-csrf-token", bidderCsrf)
      .field("evidenceType", "GST_CERTIFICATE")
      .attach("file", makePdf("FORM GST REG-06", "Registration Certificate", "GSTIN: 27AAPFU0939F1ZV"), "gst-again.pdf");
    expect(reuploadRes.body.duplicate).toBe(true);
    const listRes2 = await bidderAgent.get("/api/v1/bidder/vault");
    expect(listRes2.body.items).toHaveLength(1);
  }, 30_000);

  it("readiness check finds the matching evidence in the vault (preview, not a decision)", async () => {
    const res = await bidderAgent.post(`/api/v1/bidder/tenders/${tenderId}/readiness`).set("x-csrf-token", bidderCsrf);
    expect(res.status).toBe(200);
    expect(res.body.preview).toBe(true);
    const item = res.body.items.find((i: { requirementCode: string }) => i.requirementCode === "R-01");
    expect(item.status).toBe("AVAILABLE");
    expect(item.mandatory).toBe(true);
  });

  it("creates a bid — regression guard for the mergeParams bug (req.params.tenderId must not be undefined)", async () => {
    const res = await bidderAgent.post(`/api/v1/bidder/tenders/${tenderId}/bids`).set("x-csrf-token", bidderCsrf);
    expect(res.status).toBe(201);
    expect(res.body.tenderId).toBe(tenderId); // would be undefined/mismatched if the params bug regressed
    expect(res.body.bidderOrgId).toBe(bidderOrgId);
    expect(res.body.state).toBe("DRAFT");
  });

  it("attaches the vault document, pre-checks, and submits with a real manifest hash", async () => {
    const bidsRes = await bidderAgent.get("/api/v1/bids");
    const bid = bidsRes.body.items.find((b: { tenderId: string }) => b.tenderId === tenderId);

    const attachRes = await bidderAgent
      .post(`/api/v1/bids/${bid.id}/documents`)
      .set("x-csrf-token", bidderCsrf)
      .send({ documentId: vaultDocumentId, requirementCodes: ["R-01"] });
    expect(attachRes.status).toBe(201);

    const precheckRes = await bidderAgent.post(`/api/v1/bids/${bid.id}/precheck`);
    expect(precheckRes.body.ready).toBe(true);

    // Rejected without the declaration accepted, checked BEFORE the real submit below — a bid can
    // only be submitted once (unique per tender+bidder), so this can't be a separate test using
    // its own fresh bid; it has to run against this same draft first.
    const rejectedRes = await bidderAgent.post(`/api/v1/bids/${bid.id}/submit`).set("x-csrf-token", bidderCsrf).send({ declarationAccepted: false });
    expect(rejectedRes.status).toBe(400);

    const submitRes = await bidderAgent.post(`/api/v1/bids/${bid.id}/submit`).set("x-csrf-token", bidderCsrf).send({ declarationAccepted: true });
    expect(submitRes.status).toBe(200);
    expect(submitRes.body.state).toBe("SUBMITTED");
    expect(submitRes.body.submissionId).toBeTruthy();
    expect(submitRes.body.manifest).toHaveLength(1);
    expect(submitRes.body.manifest[0].documentId).toBe(vaultDocumentId);

    const doc = await prisma.document.findUniqueOrThrow({ where: { id: vaultDocumentId } });
    expect(submitRes.body.manifest[0].sha256).toBe(doc.sha256);
    const expectedHash = createHash("sha256").update(JSON.stringify(submitRes.body.manifest, Object.keys(submitRes.body.manifest[0]).sort())).digest("hex");
    expect(submitRes.body.manifestHash).toBe(expectedHash);

    // Double-submit is rejected, not silently accepted twice (spec §17 idempotency intent).
    const secondSubmit = await bidderAgent.post(`/api/v1/bids/${bid.id}/submit`).set("x-csrf-token", bidderCsrf).send({ declarationAccepted: true });
    expect(secondSubmit.status).toBe(409);
  }, 20_000);

  it("the vault holds multiple evidence types independently", async () => {
    const uploadRes = await bidderAgent
      .post("/api/v1/bidder/vault")
      .set("x-csrf-token", bidderCsrf)
      .field("evidenceType", "PAN_CARD")
      .attach("file", makePdf("PERMANENT ACCOUNT NUMBER", "AABCX1234F"), "pan.pdf");
    expect(uploadRes.status).toBe(201);
    await waitForProcessing(bidderAgent, uploadRes.body.documentId);

    const listRes = await bidderAgent.get("/api/v1/bidder/vault");
    const types = listRes.body.items.map((i: { evidenceType: string }) => i.evidenceType).sort();
    expect(types).toEqual(["GST_CERTIFICATE", "PAN_CARD"]);
  }, 20_000);
});
