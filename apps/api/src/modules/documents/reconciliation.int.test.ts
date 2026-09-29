// Regression test for the walking-skeleton acceptance criterion (spec §27.1 Phase 1): "Upload two
// synthetic PDFs with matching/mismatching PAN and see the correct outcome." Drives the real HTTP
// app, the real engine (over HTTP), and the real hosted database — this is what actually caught a
// real bug during manual testing (reconcile() compared every evidence item against the claim's
// cached value instead of each evidence's own value, so a genuine mismatch never showed up).
//
// Requires the engine to be reachable at ENGINE_URL (spec §4.1). Skips cleanly, not falsely-green,
// if it isn't — see docs/PROGRESS.md: CI doesn't run the engine yet, so this is currently a
// local-only regression guard.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { createApp } from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import { hashPassword } from "../../lib/crypto.js";
import { config } from "../../config.js";
import { deleteObject } from "../../lib/storage.js";

const app = createApp();
const DEMO_OTP = process.env.DEMO_OTP ?? "000000";
const suffix = randomUUID().slice(0, 8);

// Minimal single-page PDFs with real extractable text (native, not scanned), built the same way
// as services/engine/tests/test_pipeline.py's make_pdf — a valid PDF is just bytes, and pdf.js /
// PyMuPDF only need it to be well-formed enough to parse, not pretty.
function pdfWithText(...lines: string[]): Buffer {
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

async function engineIsReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${config.ENGINE_URL}/engine/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForProcessing(agent: ReturnType<typeof request.agent>, documentId: string, timeoutMs = 15_000): Promise<string> {
  const start = Date.now();
  for (;;) {
    const res = await agent.get(`/api/v1/documents/${documentId}`);
    const status = res.body.processingStatus as string;
    if (status === "EXTRACTED" || status === "FAILED" || status === "REVIEW_REQUIRED") return status;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for document ${documentId} to finish processing (last status: ${status})`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

describe.runIf(await engineIsReachable())("PAN reconciliation across documents (spec §13.2, §27.1 Phase 1)", () => {
  let orgId: string;
  let userId: string;
  let agent: ReturnType<typeof request.agent>;
  let csrf: string;
  const documentIds: string[] = [];

  beforeAll(async () => {
    const org = await prisma.organisation.create({
      data: { code: `TEST-RECON-${suffix}`, type: "GOVERNMENT", legalName: `Test Recon Org ${suffix}`, displayName: "Test Recon Org" },
    });
    orgId = org.id;
    const email = `recon-${suffix}@test.local`;
    const user = await prisma.user.create({
      data: { email, name: "Recon Tester", portalType: "GOVERNMENT", passwordHash: await hashPassword("Test@Pass1234"), status: "ACTIVE", isDemo: true, emailVerified: true },
    });
    userId = user.id;
    await prisma.membership.create({ data: { userId: user.id, organisationId: org.id, status: "ACTIVE" } });
    await prisma.userRole.create({ data: { userId: user.id, organisationId: org.id, role: "BUYER" } });

    agent = request.agent(app);
    const loginRes = await agent.post("/api/v1/auth/government/login").send({ identifier: email, password: "Test@Pass1234" });
    const mfaRes = await agent.post("/api/v1/auth/mfa/verify").send({ challenge: loginRes.body.challenge, code: DEMO_OTP });
    expect(mfaRes.body.status).toBe("SESSION");
    csrf = (mfaRes.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("ts_csrf="))!.split(";")[0]!.split("=")[1]!;
  }, 30_000);

  afterAll(async () => {
    for (const id of documentIds) {
      const doc = await prisma.document.findUnique({ where: { id } });
      if (doc) await deleteObject(doc.storageBucket, doc.storageKey).catch(() => undefined);
    }
    await prisma.evidence.deleteMany({ where: { documentId: { in: documentIds } } });
    await prisma.extractedField.deleteMany({ where: { documentId: { in: documentIds } } });
    await prisma.reconciliationResult.deleteMany({ where: { orgId } });
    await prisma.claim.deleteMany({ where: { subjectOrgId: orgId } });
    await prisma.document.deleteMany({ where: { id: { in: documentIds } } });
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.userRole.deleteMany({ where: { userId } });
    await prisma.membership.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.organisation.delete({ where: { id: orgId } });
  }, 30_000);

  it("two documents with the SAME PAN reconcile as CONSISTENT", async () => {
    const upload1 = await agent
      .post("/api/v1/documents")
      .set("x-csrf-token", csrf)
      .attach("file", pdfWithText("PAN Card", "AABCX1234F", "Padding so this page clears the native-text threshold."), "pan-card.pdf");
    expect(upload1.status).toBe(201);
    documentIds.push(upload1.body.documentId);
    await waitForProcessing(agent, upload1.body.documentId);

    const upload2 = await agent
      .post("/api/v1/documents")
      .set("x-csrf-token", csrf)
      .attach("file", pdfWithText("ITR Ack", "PAN: AABCX1234F", "Padding so this page clears the native-text threshold."), "itr-match.pdf");
    expect(upload2.status).toBe(201);
    documentIds.push(upload2.body.documentId);
    await waitForProcessing(agent, upload2.body.documentId);

    const claimsRes = await agent.get(`/api/v1/documents/${upload2.body.documentId}/claims`);
    const panClaim = claimsRes.body.items.find((c: { claimType: string }) => c.claimType === "PAN");
    expect(panClaim).toBeTruthy();
    expect(panClaim.status).toBe("RECONCILED");
    expect(panClaim.reconciliation.outcome).toBe("CONSISTENT");
    expect(panClaim.evidence).toHaveLength(2);
    // The regression this test guards: every evidence value must be its OWN extracted value.
    const values = panClaim.reconciliation.values.map((v: { value: string }) => v.value);
    expect(new Set(values).size).toBe(1);
    expect(values[0]).toBe("AABCX1234F");
  }, 30_000);

  it("adding a THIRD document with a DIFFERENT PAN flips the claim to CONFLICT", async () => {
    const upload3 = await agent
      .post("/api/v1/documents")
      .set("x-csrf-token", csrf)
      .attach("file", pdfWithText("ITR Ack", "PAN: AABCX1234P", "Padding so this page clears the native-text threshold."), "itr-mismatch.pdf");
    expect(upload3.status).toBe(201);
    documentIds.push(upload3.body.documentId);
    await waitForProcessing(agent, upload3.body.documentId);

    const claimsRes = await agent.get(`/api/v1/documents/${upload3.body.documentId}/claims`);
    const panClaim = claimsRes.body.items.find((c: { claimType: string }) => c.claimType === "PAN");
    expect(panClaim.status).toBe("CONFLICT");
    expect(panClaim.reconciliation.outcome).toBe("CONFLICT");
    expect(panClaim.evidence).toHaveLength(3);

    // The regression this test guards: each of the three evidence rows must carry its OWN value,
    // not the claim's single cached one — that's exactly what made the CONFLICT invisible before.
    const values = panClaim.reconciliation.values.map((v: { value: string }) => v.value);
    expect(values.filter((v: string) => v === "AABCX1234F")).toHaveLength(2);
    expect(values.filter((v: string) => v === "AABCX1234P")).toHaveLength(1);

    const thisDocEvidence = panClaim.evidence.find((e: { isThisDocument: boolean }) => e.isThisDocument);
    expect(thisDocEvidence.excerpt).toBe("AABCX1234P");
    // Real bbox provenance, not a placeholder (spec §9.1, §11).
    expect(thisDocEvidence.bbox.x1).toBeGreaterThan(thisDocEvidence.bbox.x0);
  }, 30_000);
});
