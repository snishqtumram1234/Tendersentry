// Source registry & capability status (spec §14.6 — the honesty mechanism). `LIVE_VALIDATED` is
// meant to be *computed* from credentials + a real health check, never hand-set; since no live
// external adapter is wired up yet (no GSP/DigiLocker credentials exist in this environment), every
// row here reflects what's actually true today rather than an aspirational claim. STRUCTURAL and
// CROSS_DOCUMENT are marked LIVE_VALIDATED because they really are live — they're local checks
// that already run automatically during document processing (spec §9.1, §13.2), not because
// anyone hand-set the flag.
import type { CapabilityStatus, CredentialStatus, SourceCode, VerificationMethod } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";

export interface SourceSeed {
  code: SourceCode;
  name: string;
  method: VerificationMethod;
  environment: string;
  capabilityStatus: CapabilityStatus;
  credentialStatus: CredentialStatus;
  portalUrl: string | null;
  instructions: string | null;
}

export const SOURCE_SEEDS: SourceSeed[] = [
  { code: "STRUCTURAL", name: "Structural format validation", method: "STRUCTURAL", environment: "local", capabilityStatus: "LIVE_VALIDATED", credentialStatus: "CONFIGURED", portalUrl: null, instructions: "Runs automatically during document extraction — no officer action needed." },
  { code: "CROSS_DOCUMENT", name: "Cross-document reconciliation", method: "RECONCILIATION", environment: "local", capabilityStatus: "LIVE_VALIDATED", credentialStatus: "CONFIGURED", portalUrl: null, instructions: "Runs automatically after each document upload — no officer action needed." },
  { code: "PDF_SIGNATURE", name: "PDF digital signature", method: "DIGITAL_SIGNATURE", environment: "local", capabilityStatus: "UNAVAILABLE", credentialStatus: "MISSING", portalUrl: null, instructions: "Trust roots not yet configured — see engine/verification/trust_roots/." },
  { code: "QR", name: "QR payload decode", method: "QR", environment: "local", capabilityStatus: "UNAVAILABLE", credentialStatus: "MISSING", portalUrl: null, instructions: "QR codes are decoded during extraction, but signed-payload verification against an issuer key isn't wired up yet." },
  { code: "PAN", name: "PAN — Income Tax e-Filing portal", method: "OFFICER_ASSISTED", environment: "manual", capabilityStatus: "MANUAL_ONLY", credentialStatus: "MISSING", portalUrl: "https://eportal.incometax.gov.in/iec/foservices/#/pre-login/verify-your-pan", instructions: "Enter the PAN and the legal name shown on the certificate; record whether the portal returns a match." },
  { code: "GST", name: "GSTIN — GST portal", method: "OFFICER_ASSISTED", environment: "manual", capabilityStatus: "MANUAL_ONLY", credentialStatus: "MISSING", portalUrl: "https://services.gst.gov.in/services/searchtp", instructions: "Search the GSTIN; record the legal name and registration status shown." },
  { code: "UDYAM", name: "Udyam registration", method: "OFFICER_ASSISTED", environment: "manual", capabilityStatus: "MANUAL_ONLY", credentialStatus: "MISSING", portalUrl: "https://udyamregistration.gov.in/Udyam_Verify.aspx", instructions: "Search the Udyam number; record the enterprise category and status shown." },
  { code: "MCA", name: "CIN/LLPIN — MCA21", method: "OFFICER_ASSISTED", environment: "manual", capabilityStatus: "MANUAL_ONLY", credentialStatus: "MISSING", portalUrl: "https://www.mca.gov.in/mcafoportal/companyLLPMasterData.do", instructions: "Search the CIN/LLPIN; record the company status and name shown." },
  { code: "EPFO", name: "EPFO establishment", method: "OFFICER_ASSISTED", environment: "manual", capabilityStatus: "MANUAL_ONLY", credentialStatus: "MISSING", portalUrl: "https://unifiedportal-emp.epfindia.gov.in/", instructions: "Search the establishment code; record the status shown." },
  { code: "ESIC", name: "ESIC establishment", method: "OFFICER_ASSISTED", environment: "manual", capabilityStatus: "MANUAL_ONLY", credentialStatus: "MISSING", portalUrl: "https://www.esic.gov.in/", instructions: "Search the establishment code; record the status shown." },
  { code: "BIS", name: "BIS certificate", method: "OFFICER_ASSISTED", environment: "manual", capabilityStatus: "MANUAL_ONLY", credentialStatus: "MISSING", portalUrl: "https://www.services.bis.gov.in:8071/php/BIS/", instructions: "Search the certificate/license number; record the validity and holder name shown." },
  { code: "GST_PROVIDER_API", name: "GST — authorised GSP/provider API", method: "PROVIDER_API", environment: "production", capabilityStatus: "INTEGRATION_READY", credentialStatus: "MISSING", portalUrl: null, instructions: "Set GST_PROVIDER_BASE_URL and GST_PROVIDER_API_KEY to enable — no credentials configured yet." },
  { code: "DIGILOCKER", name: "DigiLocker", method: "AUTHORIZED_API", environment: "production", capabilityStatus: "INTEGRATION_READY", credentialStatus: "MISSING", portalUrl: null, instructions: "OAuth partner credentials not configured yet." },
  { code: "SIMULATED", name: "Simulated (dev only)", method: "SIMULATED", environment: "development", capabilityStatus: "DISABLED", credentialStatus: "MISSING", portalUrl: null, instructions: "Deterministic fake responses for local testing — never enabled outside development (spec §2 rule 2)." },
];

/** Idempotent upsert, called once at API startup. Never overwrites a row's live-computed fields
 * (capabilityStatus/lastHealthCheckAt) on restart if an admin or health check already changed them —
 * only fills in the static descriptive fields, so this is safe to call on every boot. */
export async function ensureVerificationSourcesSeeded(): Promise<void> {
  for (const seed of SOURCE_SEEDS) {
    await prisma.verificationSource.upsert({
      where: { code: seed.code },
      create: { code: seed.code, name: seed.name, method: seed.method, environment: seed.environment, capabilityStatus: seed.capabilityStatus, credentialStatus: seed.credentialStatus, portalUrl: seed.portalUrl, instructions: seed.instructions },
      update: { name: seed.name, portalUrl: seed.portalUrl, instructions: seed.instructions },
    });
  }
}

// spec §12.4 claim types -> the source that can verify them (only claim types with a real MVP
// route are mapped; e.g. LEGAL_NAME/REGISTERED_ADDRESS are verified indirectly via the document
// they appear on, not looked up standalone).
export const CLAIM_TYPE_TO_SOURCE: Partial<Record<string, SourceCode>> = {
  PAN: "PAN",
  GSTIN: "GST",
  CIN: "MCA",
  LLPIN: "MCA",
  UDYAM: "UDYAM",
  MSME_STATUS: "UDYAM",
  EPFO_REGISTRATION: "EPFO",
  ESIC_REGISTRATION: "ESIC",
  CERTIFICATE: "BIS",
};
