// Exception workspace (spec §15.7, minimal officer actions for the prototype: list, resolve,
// reopen). Exceptions themselves are created/auto-resolved by the compliance run
// (modules/compliance/exceptions.ts); this module is just the officer-facing read/act surface.
import { prisma } from "../../lib/prisma.js";
import { writeAudit } from "../../audit/service.js";
import { Errors } from "../../lib/errors.js";

async function assertGovAccessByBid(bidId: string, organisationId: string) {
  const bid = await prisma.bid.findUnique({ where: { id: bidId }, include: { tender: { select: { organisationId: true } } } });
  if (!bid || bid.tender.organisationId !== organisationId) throw Errors.notFound("Bid");
}

export async function listExceptionsForBid(bidId: string, organisationId: string) {
  await assertGovAccessByBid(bidId, organisationId);
  return prisma.exceptionItem.findMany({ where: { bidId }, orderBy: [{ severity: "desc" }, { createdAt: "desc" }] });
}

async function loadForGov(exceptionId: string, organisationId: string) {
  const exception = await prisma.exceptionItem.findUnique({ where: { id: exceptionId }, include: { tender: { select: { organisationId: true } } } });
  if (!exception || exception.tender.organisationId !== organisationId) throw Errors.notFound("Exception");
  return exception;
}

export async function resolveException(exceptionId: string, organisationId: string, actorId: string, resolution: string) {
  const exception = await loadForGov(exceptionId, organisationId);
  if (exception.status === "RESOLVED") throw Errors.invalidStateTransition("This exception is already resolved.");
  return prisma.$transaction(async (tx) => {
    const updated = await tx.exceptionItem.update({ where: { id: exceptionId }, data: { status: "RESOLVED", resolution, resolvedBy: actorId, resolvedAt: new Date() } });
    await writeAudit(tx, { action: "EXCEPTION_RESOLVED", entityType: "EXCEPTION", entityId: exceptionId, actorId, organisationId, tenderId: exception.tenderId, bidId: exception.bidId, reason: resolution });
    return updated;
  });
}

export async function assignException(exceptionId: string, organisationId: string, actorId: string, assigneeId: string) {
  const exception = await loadForGov(exceptionId, organisationId);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.exceptionItem.update({ where: { id: exceptionId }, data: { status: exception.status === "OPEN" ? "ASSIGNED" : exception.status, assignedTo: assigneeId } });
    await writeAudit(tx, { action: "EXCEPTION_ASSIGNED", entityType: "EXCEPTION", entityId: exceptionId, actorId, organisationId, tenderId: exception.tenderId, bidId: exception.bidId, after: { assigneeId } });
    return updated;
  });
}
