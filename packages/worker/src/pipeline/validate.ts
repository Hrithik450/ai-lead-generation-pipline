import { domainOf } from "@lead/core";
import type { MergedLead } from "../extract/merge.js";

/**
 * Validation and cleaning.
 *
 * Raw extraction output is not shippable. Every field here has been observed
 * arriving wrong from a real site: phone numbers that are actually years, emails
 * belonging to the site's agency rather than the company, headcounts of 50000 on
 * a five-person consultancy that quoted an industry statistic.
 *
 * The rule throughout is to drop a bad value rather than repair it. A lead with a
 * missing phone is honest; a lead with a plausible wrong phone wastes someone's
 * outreach and is worse than nothing.
 */

export interface ValidationIssue {
  field: string;
  value: string;
  reason: string;
}

export interface ValidatedLead extends MergedLead {
  issues: ValidationIssue[];
}

/** Above this, a stated headcount is almost always a market statistic, not the company. */
const MAX_PLAUSIBLE_EMPLOYEES = 500_000;
const EARLIEST_PLAUSIBLE_FOUNDING = 1800;

export function validateLead(lead: MergedLead, domain: string): ValidatedLead {
  const issues: ValidationIssue[] = [];
  const drop = (field: string, value: string, reason: string) => {
    issues.push({ field, value, reason });
  };

  const emails = lead.emails.filter((email) => {
    const reason = emailProblem(email, domain);
    if (reason) drop("emails", email, reason);
    return reason === null;
  });

  const phones = lead.phones
    .map(normalizePhoneE164)
    .filter((phone): phone is string => phone !== null);
  for (const original of lead.phones) {
    if (normalizePhoneE164(original) === null) {
      drop("phones", original, "not a dialable international number");
    }
  }

  const socials: Record<string, string | null> = {};
  for (const [platform, url] of Object.entries(lead.socials)) {
    if (url && !isPlausibleSocial(platform, url)) {
      drop(`socials.${platform}`, url, "url does not point at the platform's own host");
      socials[platform] = null;
    } else {
      socials[platform] = url;
    }
  }

  const currentYear = new Date().getUTCFullYear();

  let employeeCount = lead.employeeCount;
  if (employeeCount !== null && (employeeCount < 1 || employeeCount > MAX_PLAUSIBLE_EMPLOYEES)) {
    drop("employee_count", String(employeeCount), "outside plausible range for a company");
    employeeCount = null;
  }

  let foundedYear = lead.foundedYear;
  if (foundedYear !== null && (foundedYear < EARLIEST_PLAUSIBLE_FOUNDING || foundedYear > currentYear)) {
    drop("founded_year", String(foundedYear), "not a plausible founding year");
    foundedYear = null;
  }

  let fundingYear = lead.fundingYear;
  // A funding round dated before the company existed means the model attached a
  // year from unrelated copy. Both values are then suspect, but the founding year
  // is corroborated far more often, so the funding year is the one that goes.
  if (fundingYear !== null && (fundingYear > currentYear || (foundedYear !== null && fundingYear < foundedYear))) {
    drop("funding_year", String(fundingYear), "outside company lifetime");
    fundingYear = null;
  }

  const people = lead.people.filter((p) => {
    if (!isPlausiblePersonName(p.name)) {
      drop("people", p.name, "does not look like a person's name");
      return false;
    }
    return true;
  });

  return {
    ...lead,
    emails,
    phones,
    socials,
    employeeCount,
    foundedYear,
    fundingYear,
    people,
    companyName: cleanCompanyName(lead.companyName),
    description: trimTo(lead.description, 600),
    issues,
  };
}

/**
 * Why an email must be dropped, or null if it is usable.
 *
 * The third-party check is the one that matters most in practice: agency and
 * platform addresses appear in footers constantly and look perfectly valid, but
 * they reach someone with no authority over the company being researched.
 */
function emailProblem(email: string, domain: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,24}$/i.test(email)) return "malformed";

  const local = email.split("@")[0] ?? "";
  const host = email.split("@")[1] ?? "";

  if (local.length > 64 || email.length > 254) return "exceeds RFC length limits";
  if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
    return "malformed local part";
  }

  const emailDomain = registrableOf(host);
  const target = registrableOf(domain);
  if (emailDomain !== null && target !== null && emailDomain !== target) {
    return `belongs to ${emailDomain}, not ${target}`;
  }
  return null;
}

function registrableOf(host: string): string | null {
  return domainOf(`https://${host}`);
}

/**
 * Normalize to bare E.164 digits, or null if that is not possible.
 *
 * Deliberately strict about requiring a country code. A national-format number
 * with no country code is unusable to a caller who does not already know where
 * the company is, and guessing the country from the site's TLD is how you end up
 * dialing a stranger.
 */
export function normalizePhoneE164(raw: string): string | null {
  // "+49 (0)30 …" is the standard German/Dutch/Austrian way of writing a number
  // that takes a trunk 0 domestically and drops it when dialed internationally.
  // The parentheses mark it as optional, so keeping the digit yields a number that
  // does not connect. Only the bracketed form is stripped — a bare leading zero
  // after a country code is significant in Italy and must survive.
  const trimmed = raw.trim().replace(/\(\s*0\s*\)/g, "");
  const hasIntlPrefix = trimmed.startsWith("+") || trimmed.startsWith("00");
  if (!hasIntlPrefix) return null;

  const digits = trimmed.replace(/^00/, "").replace(/\D/g, "");
  // ITU-T E.164 caps the whole number at 15 digits; below 8 it cannot carry a
  // country code plus a subscriber number.
  if (digits.length < 8 || digits.length > 15) return null;
  if (/^(19|20)\d{2}$/.test(digits)) return null;
  // A run of one repeated digit is a placeholder, never a real line.
  if (/^(\d)\1+$/.test(digits)) return null;
  return `+${digits}`;
}

const SOCIAL_HOST_PATTERNS: Record<string, RegExp> = {
  linkedin: /(^|\.)linkedin\.com$/i,
  twitter: /(^|\.)(twitter\.com|x\.com)$/i,
  github: /(^|\.)github\.com$/i,
  facebook: /(^|\.)(facebook\.com|fb\.com)$/i,
};

function isPlausibleSocial(platform: string, url: string): boolean {
  const pattern = SOCIAL_HOST_PATTERNS[platform];
  if (!pattern) return true;
  try {
    const parsed = new URL(url);
    if (!pattern.test(parsed.hostname)) return false;
    // A bare profile root is the platform's own homepage, not a company page.
    return parsed.pathname.replace(/\/+$/, "").length > 1;
  } catch {
    return false;
  }
}

/**
 * Words that appear in team-page headings and never in a person's name. Checked
 * because the shape test alone cannot tell "Our Leadership" or "Join Us" from
 * "Lena Brandt" — all are two capitalized words with no digits.
 */
const HEADING_WORDS =
  /\b(our|the|meet|join|team|leadership|management|board|founders?|advisors?|people|careers?|jobs?|contact|about|imprint|impressum|kontakt|ueber|über|unser|unsere)\b/i;

/**
 * Does this look like a person's name rather than a heading?
 *
 * Team pages interleave names with section titles, and the LLM sometimes returns
 * "Our Leadership" or "Join Us" as a person. Requiring two capitalized words with
 * no digits removes most of those without needing a name dictionary; the heading
 * vocabulary above catches the rest.
 */
function isPlausiblePersonName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length < 3 || trimmed.length > 80) return false;
  if (/\d/.test(trimmed)) return false;
  if (/[@/<>]/.test(trimmed)) return false;
  if (HEADING_WORDS.test(trimmed)) return false;
  const words = trimmed.split(/\s+/);
  if (words.length < 2 || words.length > 5) return false;
  return words.every((w) => /^[\p{Lu}\p{Lo}]/u.test(w) || /^(van|von|de|der|den|di|da|del|la|le|bin|al)$/i.test(w));
}

/** Strip legal-form noise a scraper picks up around the name, keep the form itself. */
function cleanCompanyName(name: string | null): string | null {
  if (!name) return null;
  const cleaned = name
    .replace(/\s+/g, " ")
    .replace(/^[\s|–—·,-]+|[\s|–—·,-]+$/g, "")
    .replace(/\s*[-–—|]\s*(home|homepage|startseite|official site|offizielle seite)$/i, "")
    .trim();
  return cleaned.length > 1 && cleaned.length <= 200 ? cleaned : null;
}

function trimTo(text: string | null, max: number): string | null {
  if (!text) return null;
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return null;
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1).trimEnd()}…`;
}
