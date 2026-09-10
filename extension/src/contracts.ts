/**
 * FROZEN WIRE CONTRACTS — SIH26171
 *
 * These three schemas are the seam between all six workstreams. Everyone builds
 * against them with stubs, so nobody blocks anybody.
 *
 * Changing a field here breaks other people's work in progress. If you need a change,
 * say so before you make it.
 *
 * The rubric these serve:
 *   25% visual context accuracy | 20% PII detection | 20% redaction precision
 *   20% client resources        | 15% end-to-end latency
 */

// ---------------------------------------------------------------------------
// 1. PageStructure — what the DOM extractor emits. Never leaves the client as-is.
// ---------------------------------------------------------------------------

/**
 * Stable, client-minted element handle. Deliberately NOT a CSS selector and NOT a
 * coordinate: selectors tempt site-specific hardcoding (banned), and coordinates die
 * the moment the page scrolls. The client keeps the id -> live Element mapping.
 */
export type ElementId = string; // e.g. "el_42"

export type ElementRole =
  | 'button' | 'link' | 'textbox' | 'password' | 'checkbox' | 'radio'
  | 'select' | 'image' | 'canvas' | 'iframe' | 'heading' | 'text'
  | 'list' | 'table' | 'form' | 'other';

export interface BoundingBox {
  /** Viewport coordinates in CSS pixels, captured at the same instant as the pixels. */
  x: number; y: number; w: number; h: number;
}

export interface ElementNode {
  id: ElementId;
  role: ElementRole;
  /** Accessible name: aria-label, associated <label>, or trimmed text content. */
  label?: string;
  /** Current value. May contain PII — the sanitizer decides, not the extractor. */
  value?: string;
  box: BoundingBox;
  visible: boolean;
  enabled: boolean;
  required?: boolean;
  focused?: boolean;
  /** The browser's own field-purpose hint. Primary signal for PII layer 1. */
  autocomplete?: string;
  /**
   * Text from the neighbouring cell/sibling, when it differs from `label`. HTML has no
   * markup for the label:value pair, so "<td>Order Total</td><td>999999999999</td>"
   * otherwise reaches the server as naked digits. Only set when it adds information.
   */
  contextLabel?: string;
  /**
   * For <select>: what the user can actually choose.
   *
   * Without this the model sees a dropdown with no idea what is in it, so it clicks the
   * control and moves on — leaving the field unset and any dependent Submit disabled.
   * Found the first time the agent was asked to complete a real multi-step form.
   */
  options?: Array<{ value: string; label: string }>;
  /** What layer 1 thinks this field is FOR. A category, never a value. */
  fieldKind?: PiiKind;
  /** Set when the DOM cannot describe this region and the ViT must look at it. */
  needsVision?: boolean;
  children?: ElementNode[];
}

export interface PageStructure {
  url: string;
  title: string;
  capturedAt: number;
  viewport: { w: number; h: number; scrollX: number; scrollY: number };
  root: ElementNode;
}

// ---------------------------------------------------------------------------
// 2. SanitizedPayload — the ONLY shape permitted to cross the network.
// ---------------------------------------------------------------------------

export type PiiKind =
  | 'PAN' | 'AADHAAR' | 'CARD' | 'GSTIN' | 'IFSC' | 'UPI'
  | 'PHONE' | 'EMAIL' | 'PASSWORD' | 'NAME' | 'ADDRESS' | 'FACE' | 'DOB';

/** Which cascade layer fired. Layer 1 and 2 are near-certain; layer 3 is probabilistic. */
export type DetectionSource = 'dom' | 'pattern' | 'model';

/**
 * A minted placeholder. The server receives the token and the kind, never the value —
 * so it can reason "the PAN field is populated and valid" while remaining blind to it.
 * This is the PS's "server aware of the redaction scheme" requirement.
 */
export interface Placeholder {
  token: string;          // "<PII_PAN_1>"
  kind: PiiKind;
  source: DetectionSource;
  confidence: number;     // 0..1
  /** True when a checksum validated the match (Verhoeff, Luhn, GSTIN). */
  verified: boolean;
  /** Present for visual redactions so the server knows layout was preserved. */
  box?: BoundingBox;
}

/**
 * Structurally identical to ElementNode, minus anything that could carry a real value.
 * Enforced by construction in redact/, and by the invariant test in bench/.
 */
export interface SanitizedNode {
  id: ElementId;
  role: ElementRole;
  label?: string;         // sanitized
  value?: string;         // sanitized: literal text, or a token, or omitted
  box: BoundingBox;
  visible: boolean;
  enabled: boolean;
  required?: boolean;
  focused?: boolean;
  /**
   * For <select>: what the user can actually choose.
   *
   * Without this the model sees a dropdown with no idea what is in it, so it clicks the
   * control and moves on — leaving the field unset and any dependent Submit disabled.
   * Found the first time the agent was asked to complete a real multi-step form.
   */
  options?: Array<{ value: string; label: string }>;
  /** What layer 1 thinks this field is FOR. A category, never a value. */
  fieldKind?: PiiKind;
  /** Sanitized the same way `label` is — neighbouring text can carry PII too. */
  contextLabel?: string;
  /**
   * What the on-device classifier saw in this region, for elements the DOM cannot
   * describe. Carries its confidence so the prompt can discount a weak guess rather
   * than present it as fact.
   */
  vision?: { label: string; confidence: number; likelyPerson?: boolean };
  children?: SanitizedNode[];
}

/** A detection the client examined and chose not to redact. Never carries a value. */
export interface Acknowledgement {
  id: ElementId;
  kind: PiiKind;
  /** Human-readable, straight from `reconcile()`. Shown in the Privacy Ledger. */
  reason: string;
}

export interface SanitizedPayload {
  /** Never the raw URL — host kept for context, path and query stripped. */
  origin: string;
  title: string;
  capturedAt: number;
  viewport: { w: number; h: number; scrollX: number; scrollY: number };
  root: SanitizedNode;
  /** Screenshot with faces blurred and sensitive regions masked. base64 PNG/WebP. */
  screenshot?: string;
  /** Tokens only. The token -> value vault NEVER appears in this object. */
  placeholders: Placeholder[];
  /**
   * Matches the client detected and DELIBERATELY kept, with the reason.
   *
   * Without this the server cannot tell "the client never looked" from "the client
   * looked and concluded this is an order number". Its own tripwire has no DOM context,
   * so it would re-flag every legitimate decoy and refuse valid requests.
   *
   * Carries ids and kinds only — never the values.
   */
  acknowledged: Acknowledgement[];
  /** What the user asked for. */
  goal: string;
  /** Prior actions this session, so the server has continuity without extra state. */
  history: AgentAction[];
}

// ---------------------------------------------------------------------------
// 3. AgentAction — what the server returns. Validated client-side before executing.
// ---------------------------------------------------------------------------

export type ActionKind =
  | 'click' | 'type' | 'scroll' | 'select' | 'wait' | 'ask_user' | 'done';

export interface AgentAction {
  kind: ActionKind;
  /** Must reference an id the client minted this turn. Anything else is rejected. */
  target?: ElementId;
  /**
   * For 'type'. May be literal text, or a token the client resolves from the vault at
   * execution time — the server can say "put the PAN here" without knowing the PAN.
   */
  value?: string;
  scrollDelta?: number;
  /** Shown in the ledger so the user can see why the agent did what it did. */
  reasoning: string;
}

export interface AgentResponse {
  actions: AgentAction[];
  /** Set when the model wants another observe/act cycle. Client enforces a hard cap. */
  needsMoreContext?: boolean;
}

// ---------------------------------------------------------------------------
// Ledger — the artifact that PROVES the 40% rather than claiming it.
// ---------------------------------------------------------------------------

export interface LedgerEntry {
  at: number;
  origin: string;
  /** Byte-exact record of what was transmitted. A judge can open and inspect this. */
  transmitted: SanitizedPayload;
  /** Counts only, per kind — the ledger must not itself store the secrets. */
  withheld: Array<{ kind: PiiKind; count: number }>;
  timings: {
    extractMs: number;
    visionMs: number;
    sanitizeMs: number;
    networkMs: number;
    totalMs: number;
  };
  resources: { peakHeapMb: number };
}
