// Tender lifecycle, clause segmentation, and the rule review/approval workflow (spec §11, §12,
// §15.10, §21.2 — Phase 2). Scope deviations from the full spec are called out inline and
// summarised in docs/PROGRESS.md; the biggest one: this skips the UNDER_REVIEW/APPROVED
// intermediate publication-approval states (spec §8.1's full tender state machine) — BUYER can
// publish directly from DRAFT once `validate()` passes. The separate APPROVING_AUTHORITY
// publication-approval step is real spec behaviour left for a later pass.
import { randomUUID } from "node:crypto";
import type { Prisma, ProcurementMode, ReferenceDatePolicy, RequirementCategory, Envelope } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { writeAudit } from "../../audit/service.js";
import { Errors } from "../../lib/errors.js";
import { callEngine } from "../../lib/engineClient.js";

// ─────────────────────────────── Tender CRUD ───────────────────────────────

export interface CreateTenderInput {
  organisationId: string;
  createdBy: string;
  title: string;
  category?: string;
  department?: string;
  objective?: string;
  procurementMode: ProcurementMode;
  estimatedValue?: string;
  valuePublic?: boolean;
  quantity?: string;
  deliveryLocation?: string;
  requiredBy?: string;
  bidOpenAt?: string;
  bidDeadline?: string;
  techOpeningAt?: string;
  referenceDatePolicy?: ReferenceDatePolicy;
}

async function nextTenderCode(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.tender.count({ where: { code: { startsWith: `TEN-${year}-` } } });
  return `TEN-${year}-${String(count + 1).padStart(4, "0")}`;
}

export async function createTender(input: CreateTenderInput) {
  const code = await nextTenderCode();
  const publicId = randomUUID();

  const tender = await prisma.$transaction(async (tx) => {
    const t = await tx.tender.create({
      data: {
        code,
        publicId,
        organisationId: input.organisationId,
        title: input.title,
        category: input.category,
        department: input.department,
        objective: input.objective,
        procurementMode: input.procurementMode,
        estimatedValue: input.estimatedValue,
        valuePublic: input.valuePublic ?? false,
        quantity: input.quantity,
        deliveryLocation: input.deliveryLocation,
        requiredBy: input.requiredBy ? new Date(input.requiredBy) : undefined,
        bidOpenAt: input.bidOpenAt ? new Date(input.bidOpenAt) : undefined,
        bidDeadline: input.bidDeadline ? new Date(input.bidDeadline) : undefined,
        techOpeningAt: input.techOpeningAt ? new Date(input.techOpeningAt) : undefined,
        referenceDatePolicy: input.referenceDatePolicy ?? "BID_DEADLINE",
        state: "DRAFT",
        createdBy: input.createdBy,
      },
    });
    await writeAudit(tx, { action: "TENDER_CREATED", entityType: "TENDER", entityId: t.id, actorId: input.createdBy, organisationId: input.organisationId, tenderId: t.id });
    return t;
  });

  return tender;
}

export async function getTenderForOrg(tenderId: string, organisationId: string) {
  const tender = await prisma.tender.findUnique({ where: { id: tenderId } });
  if (!tender || tender.organisationId !== organisationId) throw Errors.notFound("Tender");
  return tender;
}

export async function listTendersForOrg(organisationId: string) {
  return prisma.tender.findMany({ where: { organisationId }, orderBy: { createdAt: "desc" } });
}

/** Attaches an already-uploaded document (spec §9) to a tender's current (draft) version. */
export async function attachTenderDocument(tenderId: string, organisationId: string, documentId: string, role: "MAIN" | "ANNEXURE" | "SCHEDULE" | "OTHER", actorId: string) {
  const tender = await getTenderForOrg(tenderId, organisationId);
  if (tender.state !== "DRAFT") throw Errors.invalidStateTransition("Documents can only be attached while the tender is in DRAFT.");
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc || doc.ownerOrgId !== organisationId) throw Errors.notFound("Document");

  return prisma.$transaction(async (tx) => {
    const td = await tx.tenderDocument.create({
      data: { tenderId, tenderVersion: tender.currentVersion, documentId, role, isPublic: role !== "OTHER" },
    });
    await writeAudit(tx, { action: "TENDER_DOCUMENT_ATTACHED", entityType: "TENDER", entityId: tenderId, actorId, organisationId, tenderId, after: { documentId, role } });
    return td;
  });
}

export async function listTenderDocuments(tenderId: string, organisationId: string) {
  await getTenderForOrg(tenderId, organisationId);
  return prisma.tenderDocument.findMany({
    where: { tenderId },
    include: { document: { select: { id: true, originalFilename: true, processingStatus: true } } },
    orderBy: { createdAt: "asc" },
  });
}

// ─────────────────────────────── Analysis (clause → candidate rule) ───────────────────────────────

interface EngineClause {
  clauseRef: string;
  heading: string | null;
  text: string;
  pageStart: number;
  pageEnd: number;
  isRequirementCandidate: boolean;
}

interface EngineCompileResponse {
  status: "COMPILED" | "NOT_EXPRESSIBLE" | "REVIEW_REQUIRED" | "AI_UNAVAILABLE";
  dsl: Record<string, unknown> | null;
  validationErrors: string[];
  reason: string | null;
  llmMeta: Record<string, unknown> | null;
  ambiguities: { code: string; question: string; options: string[] }[];
}

/** Segments every MAIN document's text into clauses, then attempts to compile a candidate rule
 * for each requirement-like clause (LLM if configured, otherwise an empty manual-authoring slot —
 * spec §11.2/§11.3). Idempotent-ish: re-running clears prior clauses/requirements for this tender
 * version first, so repeated analysis doesn't duplicate them. */
export async function analyzeTender(tenderId: string, organisationId: string, actorId: string) {
  const tender = await getTenderForOrg(tenderId, organisationId);
  if (tender.state !== "DRAFT") throw Errors.invalidStateTransition("Analysis can only run while the tender is in DRAFT.");

  const mainDocs = await prisma.tenderDocument.findMany({
    where: { tenderId, tenderVersion: tender.currentVersion, role: "MAIN" },
    include: { document: true },
  });
  if (mainDocs.length === 0) throw Errors.validation("Attach at least one MAIN tender document before running analysis.");

  // No cascading deletes are configured (spec keeps FKs explicit — see schema.prisma), and the FK
  // chain is ruleVersion → rule → requirement → tenderClause, so cleanup must go in that order or
  // the delete violates a foreign key constraint.
  await prisma.$transaction(async (tx) => {
    await tx.ruleVersion.deleteMany({ where: { rule: { tenderId } } });
    await tx.rule.deleteMany({ where: { tenderId } });
    await tx.requirement.deleteMany({ where: { tenderId } });
    await tx.tenderClause.deleteMany({ where: { tenderId, tenderVersion: tender.currentVersion } });
  });

  let requirementSeq = 0;
  for (const td of mainDocs) {
    const segmentRes = await callEngine<{ clauses: EngineClause[] }>("/engine/tenders/segment", {
      storage_bucket: td.document.storageBucket,
      storage_key: td.document.storageKey,
    });

    for (const clause of segmentRes.clauses) {
      const clauseRow = await prisma.tenderClause.create({
        data: {
          tenderId,
          tenderVersion: tender.currentVersion,
          documentId: td.documentId,
          clauseRef: clause.clauseRef,
          heading: clause.heading,
          text: clause.text,
          pageStart: clause.pageStart,
          pageEnd: clause.pageEnd,
          isRequirementCandidate: clause.isRequirementCandidate,
          segmentationMethod: "HEADING_REGEX_V1",
        },
      });

      if (!clause.isRequirementCandidate) continue;

      requirementSeq += 1;
      const reqCode = `R-${String(requirementSeq).padStart(2, "0")}`;

      const compileRes = await callEngine<EngineCompileResponse>("/engine/rules/compile", {
        clause_text: clause.text,
        clause_ref: clause.clauseRef,
        document_id: td.documentId,
        page: clause.pageStart,
        tender_category: tender.category,
      });

      await createRequirementAndRule(tenderId, clauseRow.id, reqCode, tender.currentVersion, compileRes, actorId);
    }
  }

  await prisma.$transaction(async (tx) => {
    await writeAudit(tx, {
      action: "TENDER_ANALYZED",
      entityType: "TENDER",
      entityId: tenderId,
      actorId,
      organisationId,
      tenderId,
      after: { requirementCount: requirementSeq },
    });
  });

  return { requirementCount: requirementSeq };
}

async function createRequirementAndRule(
  tenderId: string,
  sourceClauseId: string,
  reqCode: string,
  tenderVersion: number,
  compileRes: EngineCompileResponse,
  actorId: string
): Promise<void> {
  const category: RequirementCategory = (compileRes.dsl?.requirement_category as RequirementCategory) ?? "OTHER";
  const mandatory = Boolean(compileRes.dsl?.mandatory ?? false);
  const weight = typeof compileRes.dsl?.weight === "number" ? compileRes.dsl.weight : 0;
  const envelope: Envelope = (compileRes.dsl?.envelope as Envelope) ?? "TECHNICAL";

  await prisma.$transaction(async (tx) => {
    const requirement = await tx.requirement.create({
      data: { tenderId, code: reqCode, title: (compileRes.dsl?.name as string) ?? `Requirement ${reqCode}`, category, mandatory, weight, envelope, sourceClauseId, status: "ACTIVE" },
    });
    const rule = await tx.rule.create({ data: { requirementId: requirement.id, tenderId, code: reqCode } });

    const hasContent = compileRes.status === "COMPILED";
    const hasIssues = compileRes.validationErrors.length > 0 || compileRes.ambiguities.length > 0;
    const status = hasContent && !hasIssues ? "AI_EXTRACTED" : "REVIEW_REQUIRED";
    const origin = compileRes.llmMeta ? "AI_GENERATED" : "OFFICER_AUTHORED";

    const version = await tx.ruleVersion.create({
      data: {
        ruleId: rule.id,
        version: 1,
        origin,
        status,
        dsl: (compileRes.dsl ?? undefined) as Prisma.InputJsonValue,
        plainEnglish: (compileRes.dsl?.plain_english as string) ?? null,
        ambiguityFlags: compileRes.ambiguities as unknown as Prisma.InputJsonValue,
        validationErrors: compileRes.validationErrors as unknown as Prisma.InputJsonValue,
        llmMeta: (compileRes.llmMeta ?? undefined) as Prisma.InputJsonValue,
        tenderVersion,
        createdBy: actorId,
      },
    });
    await tx.rule.update({ where: { id: rule.id }, data: { currentVersionId: version.id } });
  });
}

// ─────────────────────────────── Requirements & rules ───────────────────────────────

export async function listRequirements(tenderId: string, organisationId: string) {
  await getTenderForOrg(tenderId, organisationId);
  return prisma.requirement.findMany({ where: { tenderId }, orderBy: { code: "asc" } });
}

export async function listTenderRules(tenderId: string, organisationId: string) {
  await getTenderForOrg(tenderId, organisationId);
  const rules = await prisma.rule.findMany({
    where: { tenderId },
    include: {
      requirement: true,
      versions: { orderBy: { version: "desc" } },
    },
    orderBy: { code: "asc" },
  });
  return rules.map((r) => ({
    ruleId: r.id,
    code: r.code,
    requirement: r.requirement,
    currentVersion: r.versions.find((v) => v.id === r.currentVersionId) ?? r.versions[0] ?? null,
    versionCount: r.versions.length,
  }));
}

export async function getRuleForOrg(ruleId: string, organisationId: string) {
  const rule = await prisma.rule.findUnique({
    where: { id: ruleId },
    include: { requirement: true, versions: { orderBy: { version: "desc" } }, tender: true },
  });
  if (!rule || rule.tender.organisationId !== organisationId) throw Errors.notFound("Rule");
  return rule;
}

/** Gets the source clause + candidate rule for the three-pane review screen (spec §21.2). */
export async function getRuleReviewData(ruleId: string, organisationId: string) {
  const rule = await getRuleForOrg(ruleId, organisationId);
  const clause = rule.requirement.sourceClauseId ? await prisma.tenderClause.findUnique({ where: { id: rule.requirement.sourceClauseId } }) : null;
  return { rule, requirement: rule.requirement, clause, versions: rule.versions };
}

// ─────────────────────────────── Rule version actions ───────────────────────────────

const MUTABLE_STATUSES = new Set(["DRAFT", "AI_EXTRACTED", "REVIEW_REQUIRED"]);

export interface EditRuleInput {
  dsl: Record<string, unknown>;
  editReason?: string;
}

/** Creates a new rule version from a manual edit or first-time manual authoring (spec §11.5). The
 * plain-English text is always regenerated deterministically from the DSL server-side — the
 * client's own preview is just a convenience, never trusted (spec §11.5: "a template renderer, not
 * the LLM", and here: not even trusting the client's render of that renderer). */
export async function editRule(ruleId: string, organisationId: string, actorId: string, input: EditRuleInput) {
  const rule = await getRuleForOrg(ruleId, organisationId);
  const latest = rule.versions[0];
  if (latest && !MUTABLE_STATUSES.has(latest.status) && !input.editReason) {
    throw Errors.validation("A reason is required when editing an approved/active rule version (spec §8.6).");
  }

  const validation = await callEngine<{ valid: boolean; schemaErrors: string[]; semanticErrors: string[] }>("/engine/rules/validate", { dsl: input.dsl });
  const rendered = await callEngine<{ plainEnglish: string }>("/engine/rules/render-english", { dsl: input.dsl });

  const nextVersionNo = (latest?.version ?? 0) + 1;
  const origin = latest ? "OFFICER_EDITED" : "OFFICER_AUTHORED";
  const priorAmbiguities = (latest?.ambiguityFlags as { code: string; question: string; options: string[]; resolution?: string }[]) ?? [];
  const errors = [...validation.schemaErrors, ...validation.semanticErrors];

  return prisma.$transaction(async (tx) => {
    const version = await tx.ruleVersion.create({
      data: {
        ruleId,
        version: nextVersionNo,
        origin,
        status: "REVIEW_REQUIRED",
        dsl: input.dsl as Prisma.InputJsonValue,
        plainEnglish: rendered.plainEnglish,
        ambiguityFlags: priorAmbiguities as unknown as Prisma.InputJsonValue,
        validationErrors: errors as unknown as Prisma.InputJsonValue,
        editReason: input.editReason,
        supersedesId: latest?.id,
        tenderVersion: rule.tender.currentVersion,
        createdBy: actorId,
      },
    });
    await writeAudit(tx, { action: "RULE_EDITED", entityType: "RULE_VERSION", entityId: version.id, actorId, organisationId, tenderId: rule.tenderId, reason: input.editReason, after: { valid: validation.valid } });
    return version;
  });
}

export async function resolveAmbiguity(ruleVersionId: string, organisationId: string, actorId: string, code: string, resolution: string) {
  const version = await prisma.ruleVersion.findUnique({ where: { id: ruleVersionId }, include: { rule: { include: { tender: true } } } });
  if (!version || version.rule.tender.organisationId !== organisationId) throw Errors.notFound("Rule version");
  if (!MUTABLE_STATUSES.has(version.status)) throw Errors.invalidStateTransition(`Cannot resolve ambiguities on a ${version.status} rule version.`);

  const flags = (version.ambiguityFlags as { code: string; question: string; options: string[]; resolution?: string }[]) ?? [];
  const idx = flags.findIndex((f) => f.code === code);
  if (idx === -1) throw Errors.notFound("Ambiguity");
  flags[idx] = { ...flags[idx]!, resolution };

  return prisma.$transaction(async (tx) => {
    const updated = await tx.ruleVersion.update({ where: { id: ruleVersionId }, data: { ambiguityFlags: flags as unknown as Prisma.InputJsonValue } });
    await writeAudit(tx, { action: "RULE_AMBIGUITY_RESOLVED", entityType: "RULE_VERSION", entityId: ruleVersionId, actorId, organisationId, tenderId: version.rule.tenderId, reason: resolution, after: { code } });
    return updated;
  });
}

function approvalGateErrors(version: { dsl: unknown; ambiguityFlags: unknown; validationErrors: unknown }): string[] {
  const errors: string[] = [];
  const dsl = version.dsl as Record<string, unknown> | null;
  if (!dsl) errors.push("The rule has no structured content yet — author it first.");
  const validationErrors = (version.validationErrors as string[]) ?? [];
  if (validationErrors.length) errors.push(`Rule has ${validationErrors.length} unresolved validation error(s).`);
  const ambiguities = (version.ambiguityFlags as { resolution?: string }[]) ?? [];
  const unresolved = ambiguities.filter((a) => !a.resolution);
  if (unresolved.length) errors.push(`${unresolved.length} ambiguity(ies) must be resolved before approval (spec §11.4).`);
  if (dsl) {
    if (typeof dsl.mandatory !== "boolean") errors.push("`mandatory` must be set.");
    if (dsl.mandatory === false && typeof dsl.weight !== "number") errors.push("Non-mandatory rules must have a weight (spec §11.4).");
    if (!Array.isArray(dsl.evidence_types) || (dsl.evidence_types as unknown[]).length === 0) errors.push("At least one evidence type must be set.");
    if (!dsl.source || typeof dsl.source !== "object") errors.push("The rule must reference its source clause.");
  }
  return errors;
}

export async function approveRuleVersion(ruleVersionId: string, organisationId: string, actorId: string) {
  const version = await prisma.ruleVersion.findUnique({ where: { id: ruleVersionId }, include: { rule: { include: { tender: true } } } });
  if (!version || version.rule.tender.organisationId !== organisationId) throw Errors.notFound("Rule version");
  if (!MUTABLE_STATUSES.has(version.status)) throw Errors.invalidStateTransition(`A ${version.status} rule version cannot be approved again.`);

  const gateErrors = approvalGateErrors(version);
  if (gateErrors.length) throw Errors.validation("Rule cannot be approved yet.", { errors: gateErrors });

  const tenderPublished = version.rule.tender.state !== "DRAFT";
  const previousActive = await prisma.ruleVersion.findFirst({ where: { ruleId: version.ruleId, status: "ACTIVE" } });
  const goStraightToActive = tenderPublished || !!previousActive;

  return prisma.$transaction(async (tx) => {
    if (previousActive) {
      await tx.ruleVersion.update({ where: { id: previousActive.id }, data: { status: "SUPERSEDED" } });
    }
    const updated = await tx.ruleVersion.update({
      where: { id: ruleVersionId },
      data: { status: goStraightToActive ? "ACTIVE" : "APPROVED", approvedBy: actorId, approvedAt: new Date() },
    });
    await tx.rule.update({ where: { id: version.ruleId }, data: { currentVersionId: updated.id } });

    // Requirement.mandatory/weight/envelope/category are the authoritative values the (future,
    // Phase 4) scoring engine reads (spec §12.1, §15.3) — they must be kept in sync with whatever
    // the approved DSL actually says, not left at whatever they were guessed to be when the
    // requirement row was first created (before the rule had real content).
    const dsl = updated.dsl as Record<string, unknown> | null;
    if (dsl) {
      await tx.requirement.update({
        where: { id: version.rule.requirementId },
        data: {
          mandatory: Boolean(dsl.mandatory),
          weight: typeof dsl.weight === "number" ? dsl.weight : 0,
          envelope: (dsl.envelope as Envelope) ?? "TECHNICAL",
          category: (dsl.requirement_category as RequirementCategory) ?? "OTHER",
        },
      });
    }

    await writeAudit(tx, { action: "RULE_APPROVED", entityType: "RULE_VERSION", entityId: ruleVersionId, actorId, organisationId, tenderId: version.rule.tenderId, after: { status: updated.status } });
    return updated;
  });
}

export async function rejectRuleVersion(ruleVersionId: string, organisationId: string, actorId: string, reason: string) {
  const version = await prisma.ruleVersion.findUnique({ where: { id: ruleVersionId }, include: { rule: { include: { tender: true } } } });
  if (!version || version.rule.tender.organisationId !== organisationId) throw Errors.notFound("Rule version");
  if (!MUTABLE_STATUSES.has(version.status)) throw Errors.invalidStateTransition(`A ${version.status} rule version cannot be rejected.`);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.ruleVersion.update({ where: { id: ruleVersionId }, data: { status: "REJECTED", rejectedReason: reason } });
    await writeAudit(tx, { action: "RULE_REJECTED", entityType: "RULE_VERSION", entityId: ruleVersionId, actorId, organisationId, tenderId: version.rule.tenderId, reason });
    return updated;
  });
}

// ─────────────────────────────── Publication ───────────────────────────────

export interface ValidationIssue {
  code: string;
  message: string;
}

export async function validateForPublication(tenderId: string, organisationId: string): Promise<{ valid: boolean; issues: ValidationIssue[] }> {
  const tender = await getTenderForOrg(tenderId, organisationId);
  const issues: ValidationIssue[] = [];

  if (!tender.title) issues.push({ code: "TITLE_MISSING", message: "Title is required." });
  if (tender.bidOpenAt && tender.bidDeadline && tender.bidOpenAt >= tender.bidDeadline) {
    issues.push({ code: "DATES_INVALID", message: "Bid opening must be before the bid deadline." });
  }
  if (tender.bidDeadline && tender.techOpeningAt && tender.bidDeadline >= tender.techOpeningAt) {
    issues.push({ code: "DATES_INVALID", message: "Bid deadline must be before technical opening." });
  }

  const documentCount = await prisma.tenderDocument.count({ where: { tenderId, tenderVersion: tender.currentVersion } });
  if (documentCount === 0) issues.push({ code: "NO_DOCUMENTS", message: "At least one document must be attached." });

  const requirements = await prisma.requirement.findMany({ where: { tenderId, status: "ACTIVE" }, include: { rules: { include: { versions: true } } } });
  if (requirements.length === 0) issues.push({ code: "NO_REQUIREMENTS", message: "At least one requirement is needed." });

  for (const req of requirements) {
    const rule = req.rules[0];
    const active = rule?.versions.find((v) => v.status === "APPROVED" || v.status === "ACTIVE");
    if (!active) issues.push({ code: "REQUIREMENT_NOT_APPROVED", message: `Requirement ${req.code} has no approved rule.` });
  }

  const pendingAmbiguities = await prisma.ruleVersion.findMany({
    where: { rule: { tenderId }, status: { in: ["APPROVED", "ACTIVE"] } },
    select: { ambiguityFlags: true, rule: { select: { code: true } } },
  });
  for (const v of pendingAmbiguities) {
    const flags = (v.ambiguityFlags as { resolution?: string }[]) ?? [];
    if (flags.some((f) => !f.resolution)) issues.push({ code: "UNRESOLVED_AMBIGUITY", message: `Rule ${v.rule.code} has an unresolved ambiguity.` });
  }

  return { valid: issues.length === 0, issues };
}

export async function publishTender(tenderId: string, organisationId: string, actorId: string) {
  const tender = await getTenderForOrg(tenderId, organisationId);
  if (tender.state !== "DRAFT") throw Errors.invalidStateTransition(`Tender is already ${tender.state}; it cannot be published again.`);

  const { valid, issues } = await validateForPublication(tenderId, organisationId);
  if (!valid) throw Errors.validation("Tender is not ready to publish.", { issues });

  return prisma.$transaction(async (tx) => {
    const approvedVersions = await tx.ruleVersion.findMany({ where: { rule: { tenderId }, status: "APPROVED" } });
    for (const v of approvedVersions) {
      await tx.ruleVersion.update({ where: { id: v.id }, data: { status: "ACTIVE" } });
    }

    const snapshot = { tender, requirements: await tx.requirement.findMany({ where: { tenderId } }) };
    await tx.tenderVersion.create({ data: { tenderId, version: tender.currentVersion, reason: "ORIGINAL", snapshot: snapshot as unknown as Prisma.InputJsonValue, createdBy: actorId } });

    const updated = await tx.tender.update({ where: { id: tenderId }, data: { state: "PUBLISHED", publishedAt: new Date() } });
    await writeAudit(tx, { action: "TENDER_PUBLISHED", entityType: "TENDER", entityId: tenderId, actorId, organisationId, tenderId, after: { activatedRuleVersions: approvedVersions.length } });
    return updated;
  });
}

// ─────────────────────────────── Public ───────────────────────────────

export async function listPublicTenders() {
  const tenders = await prisma.tender.findMany({
    where: { state: { in: ["PUBLISHED", "OPEN_FOR_BIDS", "BID_CLOSURE", "TECHNICAL_EVALUATION"] } },
    // `id` (the internal tender id) is included alongside `publicId` so a logged-in bidder browsing
    // this list can act on a tender (readiness check, create bid) without a separate lookup — those
    // endpoints take the internal id (spec's own bidder-portal routes), while `publicId` stays the
    // identifier used in the public, unauthenticated URL. Neither is sensitive; only bid/financial
    // data is (spec §15.9).
    select: { id: true, publicId: true, title: true, category: true, department: true, bidDeadline: true, estimatedValue: true, valuePublic: true, publishedAt: true },
    orderBy: { publishedAt: "desc" },
  });
  return tenders.map((t) => ({ ...t, estimatedValue: t.valuePublic ? t.estimatedValue?.toString() : null }));
}

export async function getPublicTender(publicId: string) {
  const tender = await prisma.tender.findUnique({ where: { publicId } });
  if (!tender || tender.state === "DRAFT" || tender.state === "CANCELLED") throw Errors.notFound("Tender");

  const requirements = await prisma.requirement.findMany({ where: { tenderId: tender.id, status: "ACTIVE" }, include: { rules: { include: { versions: true } } } });
  const eligibility = requirements
    .map((r) => {
      const active = r.rules[0]?.versions.find((v) => v.status === "ACTIVE" || v.status === "APPROVED");
      return active ? { requirementCode: r.code, mandatory: r.mandatory, plainEnglish: active.plainEnglish } : null;
    })
    .filter((x): x is { requirementCode: string; mandatory: boolean; plainEnglish: string | null } => x !== null);

  const documents = await prisma.tenderDocument.findMany({
    where: { tenderId: tender.id, isPublic: true },
    include: { document: { select: { id: true, originalFilename: true } } },
  });

  return {
    id: tender.id, // see listPublicTenders' comment on why this is included
    publicId: tender.publicId,
    title: tender.title,
    category: tender.category,
    department: tender.department,
    objective: tender.objective,
    procurementMode: tender.procurementMode,
    estimatedValue: tender.valuePublic ? tender.estimatedValue?.toString() : null,
    deliveryLocation: tender.deliveryLocation,
    bidOpenAt: tender.bidOpenAt,
    bidDeadline: tender.bidDeadline,
    publishedAt: tender.publishedAt,
    eligibility,
    documents: documents.map((d) => ({ id: d.document.id, filename: d.document.originalFilename, role: d.role })),
  };
}
