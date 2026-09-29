// End-to-end regression test for the officer-assisted verification queue (spec §14.3, §14.4),
// the compliance re-run it triggers (spec §15.1 VERIFICATION_UPDATE), and the decision/exception
// workflow built alongside it (spec §15.7, §15.8) — all part of the cross-phase "make the
// prototype actually work" push rather than a single numbered phase.
//
// Requires the engine reachable at ENGINE_URL — skips cleanly otherwise (see
// modules/documents/reconciliation.int.test.ts for the pattern).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { createApp } from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import { hashPassword } from "../../lib/crypto.js";
import { config } from "../../config.js";
import { ensureVerificationSourcesSeeded } from "./sources.js";

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

describe.runIf(await engineIsReachable())("officer-assisted verification -> compliance re-run -> decisions/exceptions (spec §14, §15.1, §15.7, §15.8)", () => {
  let govUserId: string;
  let govAgent: ReturnType<typeof request.agent>;
  let govCsrf: string;
  let tenderId: string;

  let bidderUserId: string;
  let bidderOrgId: string;
  let bidderAgent: ReturnType<typeof request.agent>;
  let bidderCsrf: string;
  let bidId: string;

  beforeAll(async () => {
    await ensureVerificationSourcesSeeded();

    const govOrg = await prisma.organisation.create({
      data: { code: `TEST-VERIFY-GOV-${suffix}`, type: "GOVERNMENT", legalName: `Test Verify Gov ${suffix}`, displayName: "Test Verify Gov" },
    });
    const govEmail = `verify-gov-${suffix}@test.local`;
    const govUser = await prisma.user.create({
      data: { email: govEmail, name: "Verify Gov Tester", portalType: "GOVERNMENT", passwordHash: await hashPassword("Test@Pass1234"), status: "ACTIVE", isDemo: true, emailVerified: true },
    });
    govUserId = govUser.id;
    await prisma.membership.create({ data: { userId: govUser.id, organisationId: govOrg.id, status: "ACTIVE" } });
    await prisma.userRole.create({ data: { userId: govUser.id, organisationId: govOrg.id, role: "BUYER" } });

    govAgent = request.agent(app);
    const govLogin = await govAgent.post("/api/v1/auth/government/login").send({ identifier: govEmail, password: "Test@Pass1234" });
    const govMfa = await govAgent.post("/api/v1/auth/mfa/verify").send({ challenge: govLogin.body.challenge, code: DEMO_OTP });
    govCsrf = (govMfa.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("ts_csrf="))!.split(";")[0]!.split("=")[1]!;

    const tenderRes = await govAgent.post("/api/v1/tenders").set("x-csrf-token", govCsrf).send({ title: "Verification test tender", procurementMode: "SINGLE_ENVELOPE" });
    tenderId = tenderRes.body.id;
    const uploadRes = await govAgent
      .post("/api/v1/documents")
      .set("x-csrf-token", govCsrf)
      .attach("file", makePdf("7.1 Eligibility", "The bidder's PAN must be verified against the PAN certificate on record."), "tender.pdf");
    const tenderDocumentId = uploadRes.body.documentId;
    await govAgent.post(`/api/v1/tenders/${tenderId}/documents`).set("x-csrf-token", govCsrf).send({ documentId: tenderDocumentId, role: "MAIN" });
    await govAgent.post(`/api/v1/tenders/${tenderId}/analyze`).set("x-csrf-token", govCsrf);

    const rulesRes = await govAgent.get(`/api/v1/tenders/${tenderId}/rules`);
    const rule = rulesRes.body.items[0];
    const dsl = {
      schema_version: "1.0",
      rule_code: rule.code,
      name: "PAN must be authoritatively verified",
      requirement_category: "IDENTITY",
      mandatory: true,
      weight: 100,
      envelope: "TECHNICAL",
      on_missing_evidence: "FAIL",
      evidence_types: ["PAN_CARD"],
      expression: { node: "SOURCE_VERIFIED", claim_type: "PAN", min_status: "AUTHORITATIVE_VERIFIED" },
      plain_english: "The bidder's PAN must be authoritatively verified.",
      source: { document_id: tenderDocumentId, clause_ref: "7.1", page: 1 },
    };
    const editRes = await govAgent.post(`/api/v1/rules/${rule.ruleId}/versions`).set("x-csrf-token", govCsrf).send({ dsl });
    await govAgent.post(`/api/v1/rule-versions/${editRes.body.id}/approve`).set("x-csrf-token", govCsrf);
    const publishRes = await govAgent.post(`/api/v1/tenders/${tenderId}/publish`).set("x-csrf-token", govCsrf);
    expect(publishRes.status).toBe(200);

    const bidderEmail = `verify-bidder-${suffix}@test.local`;
    const registerRes = await request(app).post("/api/v1/auth/register/bidder").send({
      email: bidderEmail,
      password: "Test@BidderPass1234",
      contactName: "Verify Bidder Tester",
      legalName: `Verify Test Bidder ${suffix}`,
      orgSubtype: "Pvt Ltd",
    });
    expect(registerRes.status).toBe(201);
    bidderUserId = registerRes.body.userId;
    bidderOrgId = registerRes.body.organisationId;

    bidderAgent = request.agent(app);
    const bidderLogin = await bidderAgent.post("/api/v1/auth/bidder/login").send({ identifier: bidderEmail, password: "Test@BidderPass1234" });
    const { generate } = await import("otplib");
    const secret = bidderLogin.body.otpauthUrl.match(/secret=([A-Z0-9]+)/)![1];
    const code = await generate({ secret });
    const bidderMfa = await bidderAgent.post("/api/v1/auth/mfa/verify").send({ challenge: bidderLogin.body.challenge, code });
    bidderCsrf = (bidderMfa.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("ts_csrf="))!.split(";")[0]!.split("=")[1]!;

    const panRes = await bidderAgent
      .post("/api/v1/bidder/vault")
      .set("x-csrf-token", bidderCsrf)
      .field("evidenceType", "PAN_CARD")
      .attach("file", makePdf("PERMANENT ACCOUNT NUMBER", "AABCX1234F"), "pan.pdf");
    await waitForProcessing(bidderAgent, panRes.body.documentId);

    const bidRes = await bidderAgent.post(`/api/v1/bidder/tenders/${tenderId}/bids`).set("x-csrf-token", bidderCsrf);
    bidId = bidRes.body.id;
    await bidderAgent.post(`/api/v1/bids/${bidId}/documents`).set("x-csrf-token", bidderCsrf).send({ documentId: panRes.body.documentId, requirementCodes: ["R-01"] });
    const submitRes = await bidderAgent.post(`/api/v1/bids/${bidId}/submit`).set("x-csrf-token", bidderCsrf).send({ declarationAccepted: true });
    expect(submitRes.status).toBe(200);
  }, 60_000);

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId: { in: [govUserId, bidderUserId] } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: [govUserId, bidderUserId] } } });
    await prisma.membership.deleteMany({ where: { userId: { in: [govUserId, bidderUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [govUserId, bidderUserId] } } });
  }, 30_000);

  it("before verification, the gate is PENDING (structurally valid but not authoritative) with an open VERIFICATION_PENDING exception", async () => {
    let latest: { gate: { status: string } } | undefined;
    const start = Date.now();
    for (;;) {
      const res = await govAgent.get(`/api/v1/bids/${bidId}/compliance/latest`);
      if (res.status === 200) {
        latest = res.body;
        break;
      }
      if (Date.now() - start > 15_000) throw new Error("Timed out waiting for the auto-triggered compliance run");
      await new Promise((r) => setTimeout(r, 300));
    }
    expect(latest!.gate.status).toBe("PENDING");

    const exceptionsRes = await govAgent.get(`/api/v1/bids/${bidId}/exceptions`);
    const openException = exceptionsRes.body.items.find((e: { category: string; status: string }) => e.category === "VERIFICATION_PENDING" && e.status !== "RESOLVED");
    expect(openException).toBeTruthy();
  }, 20_000);

  it("an officer requests verification, works the queue, and records a Match with a required capture", async () => {
    const claim = await prisma.claim.findFirstOrThrow({ where: { subjectOrgId: bidderOrgId, claimType: "PAN" } });

    const requestRes = await govAgent.post(`/api/v1/verification/claims/${claim.id}/request`).set("x-csrf-token", govCsrf);
    expect(requestRes.status).toBe(201);
    const taskId = requestRes.body.taskId as string;

    const tasksRes = await govAgent.get("/api/v1/verification/tasks");
    expect(tasksRes.body.items.some((t: { id: string }) => t.id === taskId)).toBe(true);

    // A Match without a captured artefact is rejected (spec §14.4: capture required for Match).
    const startRes = await govAgent.post(`/api/v1/verification/tasks/${taskId}/start`).set("x-csrf-token", govCsrf);
    expect(startRes.status).toBe(200);
    const rejectedRes = await govAgent
      .post(`/api/v1/verification/tasks/${taskId}/result`)
      .set("x-csrf-token", govCsrf)
      .field("outcome", "MATCH");
    expect(rejectedRes.status).toBe(400);

    const resultRes = await govAgent
      .post(`/api/v1/verification/tasks/${taskId}/result`)
      .set("x-csrf-token", govCsrf)
      .field("outcome", "MATCH")
      .field("observedValues", JSON.stringify({ legalName: "Verify Test Bidder" }))
      .attach("capture", makePdf("PAN portal screenshot — MATCH"), "capture.pdf");
    expect(resultRes.status).toBe(200);
    expect(resultRes.body.taskStatus).toBe("VERIFIED");

    const updatedClaim = await prisma.claim.findUniqueOrThrow({ where: { id: claim.id } });
    expect(updatedClaim.verificationStatus).toBe("AUTHORITATIVE_VERIFIED");
    expect(updatedClaim.verificationMethod).toBe("OFFICER_ASSISTED");

    const result = await prisma.verificationResult.findFirstOrThrow({ where: { requestId: requestRes.body.requestId } });
    expect(result.isSimulated).toBe(false);
    expect(result.capturedDocumentId).toBeTruthy();
  }, 20_000);

  it("the verification update auto-triggers a compliance re-run: gate now PASSes and the exception auto-resolves", async () => {
    let latest: { gate: { status: string }; score: { total: string } } | undefined;
    const start = Date.now();
    for (;;) {
      const res = await govAgent.get(`/api/v1/bids/${bidId}/compliance/latest`);
      if (res.status === 200 && res.body.gate.status === "PASS") {
        latest = res.body;
        break;
      }
      if (Date.now() - start > 15_000) throw new Error("Timed out waiting for the verification-triggered re-run");
      await new Promise((r) => setTimeout(r, 300));
    }
    expect(latest!.gate.status).toBe("PASS");
    expect(latest!.score.total).toBe("100");

    const exceptionsRes = await govAgent.get(`/api/v1/bids/${bidId}/exceptions`);
    const exception = exceptionsRes.body.items.find((e: { category: string }) => e.category === "VERIFICATION_PENDING");
    expect(exception.status).toBe("RESOLVED");
  }, 20_000);

  it("recording \"Technically compliant\" over an open CRITICAL exception requires explicit acknowledgement", async () => {
    // Insert a synthetic CRITICAL exception directly — the natural risk signals in this scenario
    // don't produce one, and the acknowledgement gate (spec §15.8) needs one to exercise.
    const critical = await prisma.exceptionItem.create({
      data: {
        code: `EXC-TEST-${randomUUID().slice(0, 8)}`,
        tenderId,
        bidId,
        category: "IDENTITY_CONFLICT",
        severity: "CRITICAL",
        status: "OPEN",
        dedupeKey: `IDENTITY_CONFLICT:${bidId}::synthetic-test`,
        title: "Synthetic critical exception for the acknowledgement-gate test",
      },
    });

    const blockedRes = await govAgent.post(`/api/v1/bids/${bidId}/decisions`).set("x-csrf-token", govCsrf).send({ action: "TECHNICALLY_COMPLIANT" });
    expect(blockedRes.status).toBe(400);
    expect(blockedRes.body.error.details.exceptionIds).toContain(critical.id);

    const acceptedRes = await govAgent
      .post(`/api/v1/bids/${bidId}/decisions`)
      .set("x-csrf-token", govCsrf)
      .send({ action: "TECHNICALLY_COMPLIANT", acknowledgedExceptionIds: [critical.id] });
    expect(acceptedRes.status).toBe(201);
    expect(acceptedRes.body.label).toBe("Technically compliant");

    // Both the bidder and the tender's government org can see the decision.
    const govRead = await govAgent.get(`/api/v1/bids/${bidId}/decisions`);
    expect(govRead.body.items).toHaveLength(1);
    const bidderRead = await bidderAgent.get(`/api/v1/bids/${bidId}/decisions`);
    expect(bidderRead.body.items).toHaveLength(1);

    // Resolving the exception is a separate, auditable officer action.
    const resolveRes = await govAgent.post(`/api/v1/exceptions/${critical.id}/resolve`).set("x-csrf-token", govCsrf).send({ resolution: "Reviewed manually — not a genuine conflict." });
    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.status).toBe("RESOLVED");
  });

  it("a non-compliant decision requires a note", async () => {
    const withoutNote = await govAgent.post(`/api/v1/bids/${bidId}/decisions`).set("x-csrf-token", govCsrf).send({ action: "TECHNICALLY_NON_COMPLIANT" });
    expect(withoutNote.status).toBe(400);

    const withNote = await govAgent
      .post(`/api/v1/bids/${bidId}/decisions`)
      .set("x-csrf-token", govCsrf)
      .send({ action: "TECHNICALLY_NON_COMPLIANT", note: "Recorded for regression-test purposes only." });
    expect(withNote.status).toBe(201);
  });
});
