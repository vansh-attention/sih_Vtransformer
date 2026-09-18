/**
 * PII layer 2 — pattern scanner. SIH26171.
 *
 * Walks free text, proposes candidates, and gates every candidate through
 * `checksums.ts`. Nothing is emitted as `verified` unless a checksum or a structural
 * rule confirmed it.
 *
 * Design note on ordering: patterns overlap badly on digit strings. A 16-digit card
 * contains a 12-digit substring; a 12-digit Aadhaar contains a 10-digit phone. So we
 * scan longest-and-strongest first and let `resolveOverlaps` drop anything swallowed
 * by a stronger, already-verified match. Getting this wrong is the classic way to
 * report a card as three phone numbers and destroy redaction precision.
 *
 * Pure. No DOM, no network.
 */

import { verify, type VerifiableKind } from './checksums.ts';
import type { PiiKind } from '../contracts.ts';

export interface Detection {
  kind: PiiKind;
  /** Offsets into the scanned string. */
  start: number;
  end: number;
  raw: string;
  /** A checksum or structural rule confirmed this. Unverified hits are speculative. */
  verified: boolean;
  confidence: number;
}

interface Rule {
  kind: PiiKind & VerifiableKind;
  re: RegExp;
  /**
   * Scan priority. Higher wins an overlap. Ordered by digit length and by how much
   * damage a miss does: leaking a card is worse than leaking a phone number.
   */
  priority: number;
  /** Score when the checksum passes vs when only the shape matched. */
  verifiedConfidence: number;
  rawConfidence: number;
}

/**
 * `rawConfidence` is deliberately low for the pure-digit kinds. An unverified 12-digit
 * run is far more likely to be an invoice number than an Aadhaar, and redacting it
 * costs us redaction precision (20% of the grade). Layer 1 DOM context can promote it
 * later if the surrounding field is actually labelled "Aadhaar".
 */
/**
 * PRINTED FORMATTING IS EVIDENCE.
 *
 * `4540 2012 2334` is grouped exactly the way an Aadhaar is printed on the card, and
 * `4111 1111 1111 1111` the way a card number is embossed. A bare run of the same
 * digits could be an invoice or an order number — the grouping could not. Treating
 * both identically threw away the strongest signal a human uses at a glance.
 *
 * This only ever RAISES an unverified score, and only for kinds with a published
 * grouping. A checksum-verified match already scores higher and is untouched.
 */
function formattingBonus(kind: PiiKind, raw: string): number {
  const s = raw.trim();
  // 4-4-4 with a real separator: the UIDAI print format.
  if (kind === 'AADHAAR' && /^\d{4}[ -]\d{4}[ -]\d{4}$/.test(s)) return 0.65;
  // 4-4-4-4: the embossed card format.
  if (kind === 'CARD' && /^(?:\d{4}[ -]){3}\d{4}$/.test(s)) return 0.65;
  return 0;
}

const RULES: Rule[] = [
  {
    kind: 'CARD',
    re: /\b(?:\d[ -]*?){13,19}\b/g,
    priority: 100,
    verifiedConfidence: 0.98,
    rawConfidence: 0.25,
  },
  {
    kind: 'AADHAAR',
    re: /\b[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}\b/g,
    priority: 90,
    verifiedConfidence: 0.97,
    rawConfidence: 0.2,
  },
  {
    kind: 'GSTIN',
    re: /\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/gi,
    priority: 85,
    verifiedConfidence: 0.99,
    rawConfidence: 0.4,
  },
  {
    kind: 'PAN',
    re: /\b[A-Z]{5}\d{4}[A-Z]\b/gi,
    priority: 80,
    verifiedConfidence: 0.95,
    rawConfidence: 0.35,
  },
  {
    kind: 'IFSC',
    re: /\b[A-Z]{4}0[A-Z0-9]{6}\b/gi,
    priority: 75,
    verifiedConfidence: 0.95,
    rawConfidence: 0.4,
  },
  {
    kind: 'EMAIL',
    re: /\b[^\s@]+@[^\s@.]+\.[^\s@,;]{2,}\b/g,
    priority: 70,
    verifiedConfidence: 0.95,
    rawConfidence: 0.5,
  },
  {
    // Scanned after EMAIL so an address is not re-reported as a bare VPA.
    kind: 'UPI',
    re: /\b[a-zA-Z0-9._-]{2,64}@[a-zA-Z][a-zA-Z0-9]{1,29}\b/g,
    priority: 65,
    verifiedConfidence: 0.85,
    rawConfidence: 0.3,
  },
  {
    kind: 'PHONE',
    re: /(?:\+?91[ -]?)?\b[6-9]\d{4}[ -]?\d{5}\b/g,
    priority: 60,
    verifiedConfidence: 0.9,
    rawConfidence: 0.3,
  },
];

/** Emit every candidate each rule proposes, checksum-gated. */
function collect(text: string): Array<Detection & { priority: number }> {
  const out: Array<Detection & { priority: number }> = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(text)) !== null) {
      const raw = m[0];
      // Zero-length match guard: without this a bad regex spins forever.
      if (raw.length === 0) {
        rule.re.lastIndex++;
        continue;
      }
      const verified = verify(rule.kind, raw);
      out.push({
        kind: rule.kind,
        start: m.index,
        end: m.index + raw.length,
        raw,
        verified,
        confidence: verified
          ? rule.verifiedConfidence
          : Math.max(rule.rawConfidence, formattingBonus(rule.kind, raw)),
        priority: rule.priority,
      });
    }
  }
  return out;
}

/**
 * Resolve overlaps. A verified match always beats an unverified one; after that,
 * higher priority wins, then the longer span. Losers are dropped entirely rather than
 * trimmed — a partial redaction of a card number is worse than none, because it looks
 * like the system worked.
 */
function resolveOverlaps(
  candidates: Array<Detection & { priority: number }>,
): Detection[] {
  const ranked = [...candidates].sort((a, b) => {
    if (a.verified !== b.verified) return a.verified ? -1 : 1;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return b.end - b.start - (a.end - a.start);
  });

  const kept: Detection[] = [];
  for (const c of ranked) {
    const clashes = kept.some((k) => c.start < k.end && k.start < c.end);
    if (!clashes) {
      const { priority: _priority, ...detection } = c;
      kept.push(detection);
    }
  }
  return kept.sort((a, b) => a.start - b.start);
}

/** Scan a string for pattern-detectable PII. */
export function scanText(text: string): Detection[] {
  if (!text) return [];
  return resolveOverlaps(collect(text));
}

/**
 * Only the matches we are confident enough to act on unilaterally.
 *
 * Unverified low-confidence hits are NOT dropped by the caller — they are handed to
 * layer 1, which can promote them when the surrounding field is labelled (an
 * unverified 12-digit run inside a field named "aadhaar_no" is an Aadhaar). This is
 * the seam where recall and precision are traded, and it is worth 40% of the grade.
 */
export function scanTextConfident(text: string, threshold = 0.8): Detection[] {
  return scanText(text).filter((d) => d.confidence >= threshold);
}
