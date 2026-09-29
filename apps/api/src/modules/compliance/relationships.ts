// Relationship signals (spec §15.6, MVP in PostgreSQL): shared director/address/contact between
// a bidder and another bidder on the *same* tender. Needs a cross-bid database query, which the
// stateless engine can't do (ADR-004) — computed here and merged into the risk assessment.
//
// Deviation: nothing populates Director/Address/Contact yet — bidder self-registration
// (Phase 3) captures only the authorised person, and the extraction pipeline only produces PAN/
// GSTIN claims so far. This is real, tested comparison logic; it will genuinely start finding
// matches once director/address/contact extraction exists, and returns an honest empty list
// until then rather than a fabricated "no relationships found" claim.
import { prisma } from "../../lib/prisma.js";

export interface RelationshipSignal {
  category: "RELATIONSHIP_SIGNAL";
  severity: "MEDIUM";
  detail: string;
  linkedOrgId: string;
  linkedBidId: string;
}

export async function computeRelationshipSignals(tenderId: string, bidderOrgId: string): Promise<RelationshipSignal[]> {
  const otherBids = await prisma.bid.findMany({ where: { tenderId, bidderOrgId: { not: bidderOrgId } }, select: { id: true, bidderOrgId: true } });
  if (otherBids.length === 0) return [];
  const otherOrgIds = [...new Set(otherBids.map((b) => b.bidderOrgId))];
  const bidIdByOrg = new Map(otherBids.map((b) => [b.bidderOrgId, b.id]));

  const signals: RelationshipSignal[] = [];
  const seen = new Set<string>(); // dedupe (linkedOrgId, kind) pairs

  const push = (linkedOrgId: string, detail: string, kind: string) => {
    const key = `${linkedOrgId}:${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    const linkedBidId = bidIdByOrg.get(linkedOrgId);
    if (!linkedBidId) return;
    signals.push({ category: "RELATIONSHIP_SIGNAL", severity: "MEDIUM", detail, linkedOrgId, linkedBidId });
  };

  const myDirectors = await prisma.director.findMany({ where: { organisationId: bidderOrgId, din: { not: null } } });
  if (myDirectors.length > 0) {
    const dins = myDirectors.map((d) => d.din as string);
    const matches = await prisma.director.findMany({ where: { organisationId: { in: otherOrgIds }, din: { in: dins } } });
    for (const m of matches) push(m.organisationId, `Shared director (DIN ${m.din}) with another bidder on this tender.`, "director");
  }

  const myAddresses = await prisma.address.findMany({ where: { organisationId: bidderOrgId } });
  if (myAddresses.length > 0) {
    const hashes = myAddresses.map((a) => a.hash);
    const matches = await prisma.address.findMany({ where: { organisationId: { in: otherOrgIds }, hash: { in: hashes } } });
    for (const m of matches) push(m.organisationId, "Shared registered address with another bidder on this tender.", "address");
  }

  const myContacts = await prisma.contact.findMany({ where: { organisationId: bidderOrgId } });
  if (myContacts.length > 0) {
    const values = myContacts.map((c) => c.valueNormalised);
    const matches = await prisma.contact.findMany({ where: { organisationId: { in: otherOrgIds }, valueNormalised: { in: values } } });
    for (const m of matches) push(m.organisationId, "Shared contact detail with another bidder on this tender.", "contact");
  }

  return signals;
}
