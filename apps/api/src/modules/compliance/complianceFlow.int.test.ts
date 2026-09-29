// End-to-end regression test for the Phase 4 compliance interpreter/gate/score/risk/exception
// pipeline (spec §12, §15, §27.1): publish a tender with two mandatory requirements, have a
// bidder submit a bid with evidence for only one of them, and confirm the auto-triggered
// compliance run reports the correct gate/score/exception state — then fix the gap, have an
// officer manually re-run, and confirm the exception auto-resolves.
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

describe.runIf(await engineIsReachable())("compliance run: interpreter → gate → score → exceptions (spec §12, §15, §27.1 Phase 4)", () => {
  let govUserId: string;
  let govAgent: ReturnType<typeof request.agent>;
  let govCsrf: string;
  let tenderId: string;
  let tenderDocumentId: string;

  let bidderUserId: string;
  let bidderAgent: ReturnType<typeof request.agent>;
  let bidderCsrf: string;
  let gstDocumentId: string;
  let bidId: string;

  beforeAll(async () => {
    const govOrg = await prisma.organisation.create({
      data: { code: `TEST-COMPLIANCE-GOV-${suffix}`, type: "GOVERNMENT", legalName: `Test Compliance Gov ${suffix}`, displayName: "Test Compliance Gov" },
    });
    const govEmail = `compliance-gov-${suffix}@test.local`;
    const govUser = await prisma.user.create({
      data: { email: govEmail, name: "Compliance Gov Tester", portalType: "GOVERNMENT", passwordHash: await hashPassword("Test@Pass1234"), status: "ACTIVE", isDemo: true, emailVerified: true },
    });
    govUserId = govUser.id;
    await prisma.membership.create({ data: { userId: govUser.id, organisationId: govOrg.id, status: "ACTIVE" } });
    await prisma.userRole.create({ data: { userId: govUser.id, organisationId: govOrg.id, role: "BUYER" } });

    govAgent = request.agent(app);
    const govLogin = await govAgent.post("/api/v1/auth/government/login").send({ identifier: govEmail, password: "Test@Pass1234" });
    const govMfa = await govAgent.post("/api/v1/auth/mfa/verify").send({ challenge: govLogin.body.challenge, code: DEMO_OTP });
    govCsrf = (govMfa.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("ts_csrf="))!.split(";")[0]!.split("=")[1]!;

    const tenderRes = await govAgent.post("/api/v1/tenders").set("x-csrf-token", govCsrf).send({ title: "Compliance test tender", procurementMode: "SINGLE_ENVELOPE" });
    tenderId = tenderRes.body.id;
    const uploadRes = await govAgent
      .post("/api/v1/documents")
      .set("x-csrf-token", govCsrf)
      .attach("file", makePdf("7.1 Eligibility", "The bidder shall submit a valid GST registration certificate."), "tender.pdf");
    tenderDocumentId = uploadRes.body.documentId;
    await govAgent.post(`/api/v1/tenders/${tenderId}/documents`).set("x-csrf-token", govCsrf).send({ documentId: tenderDocumentId, role: "MAIN" });
    await govAgent.post(`/api/v1/tenders/${tenderId}/analyze`).set("x-csrf-token", govCsrf);

    const rulesRes = await govAgent.get(`/api/v1/tenders/${tenderId}/rules`);
    const rule1 = rulesRes.body.items[0];
    const dsl1 = {
      schema_version: "1.0",
      rule_code: rule1.code,
      name: "Valid GST registration",
      requirement_category: "STATUTORY",
      mandatory: true,
      weight: 60,
      envelope: "TECHNICAL",
      on_missing_evidence: "FAIL",
      evidence_types: ["GST_CERTIFICATE"],
      expression: { node: "DOCUMENT_EXISTS", doc_type: "GST_CERTIFICATE", min_count: 1 },
      plain_english: "A valid GST registration certificate must be on file.",
      source: { document_id: tenderDocumentId, clause_ref: "7.1", page: 1 },
    };
    const editRes = await govAgent.post(`/api/v1/rules/${rule1.ruleId}/versions`).set("x-csrf-token", govCsrf).send({ dsl: dsl1 });
    await govAgent.post(`/api/v1/rule-versions/${editRes.body.id}/approve`).set("x-csrf-token", govCsrf);

    // A second mandatory requirement, inserted directly via Prisma rather than through clause
    // segmentation — segmentation heuristics on a synthetic one-clause PDF are exercised enough
    // by tenderFlow.int.test.ts; this test only needs a second ACTIVE rule to evaluate, which is
    // exactly what publish + this direct insert produce together.
    const requirement2 = await prisma.requirement.create({
      data: { tenderId, code: "R-02", title: "PAN card on file", category: "IDENTITY", mandatory: true, weight: 40, envelope: "TECHNICAL", status: "ACTIVE" },
    });
    const rule2 = await prisma.rule.create({ data: { tenderId, requirementId: requirement2.id, code: "R-02" } });
    const dsl2 = {
      schema_version: "1.0",
      rule_code: "R-02",
      name: "PAN card on file",
      requirement_category: "IDENTITY",
      mandatory: true,
      weight: 40,
      envelope: "TECHNICAL",
      on_missing_evidence: "FAIL",
      evidence_types: ["PAN_CARD"],
      expression: { node: "DOCUMENT_EXISTS", doc_type: "PAN_CARD", min_count: 1 },
      plain_english: "A PAN card must be on file.",
      source: { document_id: tenderDocumentId, clause_ref: "7.2", page: 1 },
    };
    const rv2 = await prisma.ruleVersion.create({
      data: { ruleId: rule2.id, version: 1, origin: "OFFICER_AUTHORED", status: "APPROVED", dsl: dsl2, plainEnglish: dsl2.plain_english, tenderVersion: 1, approvedBy: govUserId, approvedAt: new Date() },
    });
    await prisma.rule.update({ where: { id: rule2.id }, data: { currentVersionId: rv2.id } });

    const publishRes = await govAgent.post(`/api/v1/tenders/${tenderId}/publish`).set("x-csrf-token", govCsrf);
    expect(publishRes.status).toBe(200);
    const rv2AfterPublish = await prisma.ruleVersion.findUniqueOrThrow({ where: { id: rv2.id } });
    expect(rv2AfterPublish.status).toBe("ACTIVE"); // publish promotes APPROVED -> ACTIVE (spec §8.6), same as rule1

    const bidderEmail = `compliance-bidder-${suffix}@test.local`;
    const registerRes = await request(app).post("/api/v1/auth/register/bidder").send({
      email: bidderEmail,
      password: "Test@BidderPass1234",
      contactName: "Compliance Bidder Tester",
      legalName: `Compliance Test Bidder ${suffix}`,
      orgSubtype: "Pvt Ltd",
    });
    expect(registerRes.status).toBe(201);
    bidderUserId = registerRes.body.userId;

    bidderAgent = request.agent(app);
    const bidderLogin = await bidderAgent.post("/api/v1/auth/bidder/login").send({ identifier: bidderEmail, password: "Test@BidderPass1234" });
    const { generate } = await import("otplib");
    const secret = bidderLogin.body.otpauthUrl.match(/secret=([A-Z0-9]+)/)![1];
    const code = await generate({ secret });
    const bidderMfa = await bidderAgent.post("/api/v1/auth/mfa/verify").send({ challenge: bidderLogin.body.challenge, code });
    bidderCsrf = (bidderMfa.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("ts_csrf="))!.split(";")[0]!.split("=")[1]!;

    // Only GST evidence for now — PAN card comes later in the test, deliberately, to exercise the
    // "gate FAIL, then fixed, then re-run" path.
    const gstRes = await bidderAgent
      .post("/api/v1/bidder/vault")
      .set("x-csrf-token", bidderCsrf)
      .field("evidenceType", "GST_CERTIFICATE")
      .attach("file", makePdf("FORM GST REG-06", "Registration Certificate", "GSTIN: 27AAPFU0939F1ZV"), "gst.pdf");
    gstDocumentId = gstRes.body.documentId;
    await waitForProcessing(bidderAgent, gstDocumentId);

    const bidRes = await bidderAgent.post(`/api/v1/bidder/tenders/${tenderId}/bids`).set("x-csrf-token", bidderCsrf);
    bidId = bidRes.body.id;
    await bidderAgent.post(`/api/v1/bids/${bidId}/documents`).set("x-csrf-token", bidderCsrf).send({ documentId: gstDocumentId, requirementCodes: ["R-01"] });
    const submitRes = await bidderAgent.post(`/api/v1/bids/${bidId}/submit`).set("x-csrf-token", bidderCsrf).send({ declarationAccepted: true });
    expect(submitRes.status).toBe(200); // submission itself succeeds even though R-02's evidence is still missing
  }, 60_000);

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId: { in: [govUserId, bidderUserId] } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: [govUserId, bidderUserId] } } });
    await prisma.membership.deleteMany({ where: { userId: { in: [govUserId, bidderUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [govUserId, bidderUserId] } } });
  }, 30_000);

  it("submission auto-triggers a compliance run: R-01 passes, R-02 fails, gate FAILs, score is partial", async () => {
    // Submission's compliance trigger is awaited server-side (spec §15.1 SUBMISSION trigger) but
    // this test still polls briefly for resilience against timing changes.
    let run: { gate: { status: string }; score: { total: string; provisional: boolean }; results: { requirementId: string; result: string }[] } | undefined;
    const start = Date.now();
    for (;;) {
      const res = await govAgent.get(`/api/v1/bids/${bidId}/compliance/latest`);
      if (res.status === 200) {
        run = res.body;
        break;
      }
      if (Date.now() - start > 15_000) throw new Error("Timed out waiting for the auto-triggered compliance run");
      await new Promise((r) => setTimeout(r, 300));
    }

    expect(run!.gate.status).toBe("FAIL");
    expect(run!.score.total).toBe("60"); // only R-01's weight (60) earned out of 100 applicable; Prisma's Decimal JSON serialization drops trailing zeros
    const r1 = run!.results.find((r) => r.result === "PASS");
    const r2 = run!.results.find((r) => r.result === "FAIL");
    expect(r1).toBeTruthy();
    expect(r2).toBeTruthy();

    const exceptionsCount = await prisma.exceptionItem.count({ where: { bidId, category: "MANDATORY_GATE_FAILED", status: { not: "RESOLVED" } } });
    expect(exceptionsCount).toBe(1);
  }, 20_000);

  it("bidder cannot manually trigger a run — evaluation.run is an officer-only permission", async () => {
    const res = await bidderAgent.post(`/api/v1/bids/${bidId}/compliance/run`).set("x-csrf-token", bidderCsrf);
    expect(res.status).toBe(403);
  });

  it("after the bidder adds the missing evidence, an officer re-run passes the gate and auto-resolves the exception", async () => {
    const panRes = await bidderAgent
      .post("/api/v1/bidder/vault")
      .set("x-csrf-token", bidderCsrf)
      .field("evidenceType", "PAN_CARD")
      .attach("file", makePdf("PERMANENT ACCOUNT NUMBER", "AABCX1234F"), "pan.pdf");
    await waitForProcessing(bidderAgent, panRes.body.documentId);

    const runRes = await govAgent.post(`/api/v1/bids/${bidId}/compliance/run`).set("x-csrf-token", govCsrf);
    expect(runRes.status).toBe(201);

    const latest = await govAgent.get(`/api/v1/bids/${bidId}/compliance/latest`);
    expect(latest.body.gate.status).toBe("PASS");
    expect(latest.body.score.total).toBe("100");
    expect(latest.body.score.provisional).toBe(false);

    const exception = await prisma.exceptionItem.findFirst({ where: { bidId, category: "MANDATORY_GATE_FAILED" } });
    expect(exception!.status).toBe("RESOLVED");
    expect(exception!.resolution).toContain("Condition no longer present");

    const runsRes = await govAgent.get(`/api/v1/bids/${bidId}/compliance/runs`);
    expect(runsRes.body.items.length).toBeGreaterThanOrEqual(2);
  }, 20_000);

  it("fetching a specific run by id round-trips the same result the dashboard would show", async () => {
    const runsRes = await govAgent.get(`/api/v1/bids/${bidId}/compliance/runs`);
    const latestRunId = runsRes.body.items[0].id;
    const res = await govAgent.get(`/api/v1/compliance-runs/${latestRunId}`);
    expect(res.status).toBe(200);
    expect(res.body.gate.status).toBe("PASS");

    // Bidder org can read its own run too (spec: visible to the bidder org and the tender's
    // government org — never a third party).
    const bidderRead = await bidderAgent.get(`/api/v1/compliance-runs/${latestRunId}`);
    expect(bidderRead.status).toBe(200);
  });
});
