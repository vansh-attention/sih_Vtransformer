/**
 * Checksum validators — SIH26171 PII layer 2.
 *
 * WHY THIS FILE IS THE DIFFERENTIATOR
 *
 * Precision is scored twice in this PS: 20% for PII detection precision/recall, and
 * 20% for redaction precision. A naive team writes /\d{12}/ for Aadhaar, flags every
 * order number and invoice total on the page, and torches both scores while claiming
 * "good recall".
 *
 * A checksum turns a recall-heavy pattern into a precision-heavy detector. A random
 * 12-digit string passes Verhoeff roughly 1 time in 10, so gating on it removes ~90%
 * of false positives at zero cost to recall — real Aadhaar numbers always pass.
 *
 * Every function here is pure. No DOM, no network, no browser. Fully unit-testable.
 */

// ---------------------------------------------------------------------------
// Verhoeff — Aadhaar
// ---------------------------------------------------------------------------

/** Dihedral group D5 multiplication table. */
const D5_MUL: readonly number[][] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

/** Permutation table, applied cyclically by position. */
const D5_PERM: readonly number[][] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/** Verhoeff check. The trailing digit of `digits` is the check digit. */
export function isVerhoeffValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let c = 0;
  // Process right-to-left; position 0 is the check digit itself.
  for (let i = 0; i < digits.length; i++) {
    const digit = Number(digits[digits.length - 1 - i]);
    c = D5_MUL[c][D5_PERM[i % 8][digit]];
  }
  return c === 0;
}

/**
 * Aadhaar: 12 digits, never starts with 0 or 1 (UIDAI reserves those), Verhoeff-valid.
 * The leading-digit rule alone removes another slice of false positives for free.
 */
export function isAadhaar(candidate: string): boolean {
  const digits = candidate.replace(/[\s-]/g, '');
  if (!/^[2-9]\d{11}$/.test(digits)) return false;
  return isVerhoeffValid(digits);
}

// ---------------------------------------------------------------------------
// Luhn — payment cards
// ---------------------------------------------------------------------------

export function isLuhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Card numbers run 13–19 digits and must satisfy Luhn. */
export function isCardNumber(candidate: string): boolean {
  const digits = candidate.replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(digits)) return false;
  return isLuhnValid(digits);
}

// ---------------------------------------------------------------------------
// GSTIN — has its own mod-36 checksum
// ---------------------------------------------------------------------------

const GSTIN_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * GSTIN: 15 chars — 2-digit state code, 10-char PAN, entity digit, 'Z', check char.
 * Weighted mod-36 over the first 14 characters.
 */
export function isGstin(candidate: string): boolean {
  const s = candidate.toUpperCase().trim();
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(s)) return false;

  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = GSTIN_ALPHABET.indexOf(s[i]);
    if (value < 0) return false;
    const factor = i % 2 === 0 ? 1 : 2;
    const product = value * factor;
    // Digit-sum in base 36, not base 10.
    sum += Math.floor(product / 36) + (product % 36);
  }
  const expected = GSTIN_ALPHABET[(36 - (sum % 36)) % 36];
  return expected === s[14];
}

// ---------------------------------------------------------------------------
// Structural validators — no checksum exists, so we exploit format semantics
// ---------------------------------------------------------------------------

/**
 * PAN has no checksum, so we lean on structure instead. The 4th character encodes
 * holder type and is drawn from a fixed set; checking it removes the large majority
 * of random [A-Z]{5}[0-9]{4}[A-Z] collisions.
 *
 * P individual · C company · H HUF · F firm · A AOP · T trust
 * B BOI · L local authority · J artificial juridical person · G government
 */
const PAN_HOLDER_TYPES = new Set(['P', 'C', 'H', 'F', 'A', 'T', 'B', 'L', 'J', 'G']);

export function isPan(candidate: string): boolean {
  const s = candidate.toUpperCase().trim();
  if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(s)) return false;
  return PAN_HOLDER_TYPES.has(s[3]);
}

/** IFSC: 4-letter bank code, a mandatory '0' in position 5, then 6 alphanumerics. */
export function isIfsc(candidate: string): boolean {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(candidate.toUpperCase().trim());
}

/** UPI VPA. Deliberately conservative — the handle must look like a real PSP handle. */
export function isUpiVpa(candidate: string): boolean {
  return /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9]{1,29}$/.test(candidate.trim());
}

/** Indian mobile numbers start 6–9 and are 10 digits after any +91 / 0 prefix. */
export function isIndianMobile(candidate: string): boolean {
  const digits = candidate.replace(/[\s\-()]/g, '').replace(/^(\+91|91|0)/, '');
  return /^[6-9]\d{9}$/.test(digits);
}

/** Pragmatic email check. Deliberately not RFC 5322 — that over-matches. */
export function isEmail(candidate: string): boolean {
  return /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/.test(candidate.trim());
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export type VerifiableKind =
  | 'AADHAAR' | 'CARD' | 'GSTIN' | 'PAN' | 'IFSC' | 'UPI' | 'PHONE' | 'EMAIL';

const VALIDATORS: Record<VerifiableKind, (s: string) => boolean> = {
  AADHAAR: isAadhaar,
  CARD: isCardNumber,
  GSTIN: isGstin,
  PAN: isPan,
  IFSC: isIfsc,
  UPI: isUpiVpa,
  PHONE: isIndianMobile,
  EMAIL: isEmail,
};

/**
 * True when a real checksum or structural rule confirmed the match — as opposed to a
 * bare regex hit. Feeds `Placeholder.verified`, which the ranking in bench/ uses to
 * separate high-confidence redactions from speculative ones.
 */
export function verify(kind: VerifiableKind, candidate: string): boolean {
  const fn = VALIDATORS[kind];
  return fn ? fn(candidate) : false;
}
