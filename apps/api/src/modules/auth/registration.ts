// Bidder self-registration (spec §6.4 "/register/bidder"): account + organisation creation in one
// step. Government organisations are still SYSTEM_ADMIN-only (spec §6.4) — not built here.
import { prisma } from "../../lib/prisma.js";
import { Errors } from "../../lib/errors.js";
import { hashPassword } from "../../lib/crypto.js";
import { writeAudit } from "../../audit/service.js";

export interface RegisterBidderInput {
  email: string;
  password: string;
  contactName: string;
  mobile?: string;
  legalName: string;
  orgSubtype: string; // "Pvt Ltd" | "LLP" | "Proprietorship" | ... (spec §6.4) — free text for now
  pan?: string;
  cin?: string;
}

async function nextOrgCode(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.organisation.count({ where: { code: { startsWith: `BID-${year}-` } } });
  return `BID-${year}-${String(count + 1).padStart(5, "0")}`;
}

export async function registerBidder(input: RegisterBidderInput) {
  const existing = await prisma.user.findFirst({ where: { email: input.email.toLowerCase(), portalType: "BIDDER" } });
  if (existing) throw Errors.validation("An account with this email already exists.");

  const code = await nextOrgCode();
  const passwordHash = await hashPassword(input.password);

  return prisma.$transaction(async (tx) => {
    const org = await tx.organisation.create({
      data: {
        code,
        type: "BIDDER",
        legalName: input.legalName,
        displayName: input.legalName,
        orgSubtype: input.orgSubtype,
        pan: input.pan,
        cin: input.cin,
      },
    });
    const user = await tx.user.create({
      data: {
        email: input.email.toLowerCase(),
        name: input.contactName,
        mobile: input.mobile,
        portalType: "BIDDER",
        passwordHash,
        status: "ACTIVE",
      },
    });
    await tx.membership.create({ data: { userId: user.id, organisationId: org.id, status: "ACTIVE" } });
    await tx.userRole.create({ data: { userId: user.id, organisationId: org.id, role: "BIDDER_ADMIN" } });
    await tx.bidderProfile.create({ data: { organisationId: org.id, verificationLevel: 0, badgeStatus: "NONE" } });
    await tx.authorisedPerson.create({ data: { organisationId: org.id, name: input.contactName, email: input.email.toLowerCase(), mobile: input.mobile } });

    await writeAudit(tx, {
      action: "BIDDER_REGISTERED",
      entityType: "ORGANISATION",
      entityId: org.id,
      actorId: user.id,
      organisationId: org.id,
      after: { code: org.code, legalName: org.legalName },
    });

    return { organisationId: org.id, userId: user.id, code: org.code };
  });
}
