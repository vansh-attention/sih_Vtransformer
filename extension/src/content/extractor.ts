/**
 * DOM extractor — SIH26171 content script.
 *
 * Turns a live page into `PageStructure`. This is the "structure layer" half of the
 * core architectural bet: the DOM already knows every label, field type, coordinate
 * and enabled/disabled state exactly and for free, so the ViT never has to infer any
 * of it. That is what lets us score well on visual-context accuracy (25%) while
 * keeping client resources (20%) and latency (15%) low.
 *
 * Two hard rules, both from the PS:
 *   - NO SITE-SPECIFIC LOGIC. Finale sites are unseen. Everything here is generic
 *     HTML/ARIA semantics. If you ever want to special-case a domain, the design is
 *     wrong instead.
 *   - Node budget is enforced. An unbounded tree on a heavy page tanks the resource
 *     score, and the server does not need 40,000 layout divs to click a button.
 */

import type {
  BoundingBox, ElementId, ElementNode, ElementRole, PageStructure,
} from '../contracts.ts';
import type { FieldSignals } from '../pii/dom.ts';

// ---------------------------------------------------------------------------
// Stable element identity
// ---------------------------------------------------------------------------

/**
 * IDs are minted per session and survive re-extraction, so the server can refer to
 * "el_42" across turns. Deliberately not CSS selectors (they invite hardcoding) and
 * not coordinates (they die on the next scroll).
 */
const idByElement = new WeakMap<Element, ElementId>();
const elementById = new Map<ElementId, WeakRef<Element>>();
let idCounter = 0;

function idFor(el: Element): ElementId {
  let id = idByElement.get(el);
  if (!id) {
    id = `el_${++idCounter}`;
    idByElement.set(el, id);
    elementById.set(id, new WeakRef(el));
  }
  return id;
}

/** Reverse lookup for the action executor. Returns undefined if the node is gone. */
export function resolveElement(id: ElementId): Element | undefined {
  const el = elementById.get(id)?.deref();
  if (!el || !el.isConnected) return undefined;
  return el;
}

// ---------------------------------------------------------------------------
// Role, name, geometry
// ---------------------------------------------------------------------------

const INPUT_TYPE_ROLES: Record<string, ElementRole> = {
  password: 'password', checkbox: 'checkbox', radio: 'radio',
  button: 'button', submit: 'button', reset: 'button',
};

function roleOf(el: Element): ElementRole {
  const explicit = el.getAttribute('role');
  if (explicit === 'button' || explicit === 'link' || explicit === 'checkbox') {
    return explicit as ElementRole;
  }

  const tag = el.tagName.toLowerCase();
  switch (tag) {
    case 'input': {
      const type = (el as HTMLInputElement).type?.toLowerCase() ?? 'text';
      return INPUT_TYPE_ROLES[type] ?? 'textbox';
    }
    case 'textarea': return 'textbox';
    case 'select': return 'select';
    case 'button': return 'button';
    case 'a': return (el as HTMLAnchorElement).href ? 'link' : 'text';
    case 'img': case 'svg': return 'image';
    case 'canvas': return 'canvas';
    case 'iframe': case 'embed': case 'object': return 'iframe';
    case 'form': return 'form';
    case 'table': return 'table';
    case 'ul': case 'ol': return 'list';
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': return 'heading';
    default:
      if (el.hasAttribute('contenteditable')) return 'textbox';
      return 'other';
  }
}

/** Text belonging to this element directly, excluding descendants' own text. */
function directText(el: Element): string {
  let out = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) out += node.textContent ?? '';
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Accessible name, in the order the ARIA spec resolves it. */
function accessibleName(el: Element): string | undefined {
  const aria = el.getAttribute('aria-label')?.trim();
  if (aria) return aria;

  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent?.trim())
      .filter(Boolean)
      .join(' ');
    if (text) return text;
  }

  if (el.id) {
    const forLabel = el.ownerDocument.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    const text = forLabel?.textContent?.replace(/\s+/g, ' ').trim();
    if (text) return text;
  }

  const wrapping = el.closest('label')?.textContent?.replace(/\s+/g, ' ').trim();
  if (wrapping) return wrapping;

  const alt = el.getAttribute('alt')?.trim();
  if (alt) return alt;

  const placeholder = el.getAttribute('placeholder')?.trim();
  if (placeholder) return placeholder;

  const title = el.getAttribute('title')?.trim();
  if (title) return title;

  const own = directText(el);
  // Cap: a name is a label, not a paragraph. Long text arrives as a 'text' node.
  return own ? own.slice(0, 200) : undefined;
}

function boxOf(el: Element): BoundingBox {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
}

/**
 * Genuinely hidden: the author has removed this from the page. Safe to prune the whole
 * subtree, because nothing inside it can be seen or acted on.
 */
function isHidden(el: Element): boolean {
  const style = getComputedStyle(el);
  return style.display === 'none'
    || style.visibility === 'hidden'
    || Number(style.opacity) <= 0.05;
}

/**
 * Has actual painted area. DELIBERATELY SEPARATE from `isHidden`.
 *
 * Zero-size is NOT the same as hidden. A container whose children are all
 * `position:absolute` collapses to zero height while its children remain perfectly
 * visible. Conflating the two made `walk(document.body)` return null on the alignment
 * fixture and threw away the entire page — every element, silently, with a cheerful
 * nodeCount of 0. Found by Spike C.
 */
function hasSize(box: BoundingBox): boolean {
  return box.w > 0 && box.h > 0;
}

function isEnabled(el: Element): boolean {
  if ((el as HTMLInputElement).disabled) return false;
  return el.getAttribute('aria-disabled') !== 'true';
}

// ---------------------------------------------------------------------------
// What the DOM cannot describe — the vision layer's work queue
// ---------------------------------------------------------------------------

const VISION_TAGS = new Set(['img', 'canvas', 'video', 'svg', 'iframe', 'embed', 'object']);

/**
 * Flags regions the ViT must actually look at. Everything NOT flagged here is handled
 * by the DOM for free — which is the entire point of the hybrid design. An <img> with
 * a real alt attribute is already described, so it does not need vision.
 */
function needsVision(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (!VISION_TAGS.has(tag)) return false;
  if (tag === 'img' && (el.getAttribute('alt')?.trim().length ?? 0) > 3) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Pruning — the node budget lives or dies here
// ---------------------------------------------------------------------------

const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'meta', 'link', 'head', 'template', 'br']);

const INTERACTIVE_ROLES = new Set<ElementRole>([
  'button', 'link', 'textbox', 'password', 'checkbox', 'radio', 'select',
]);

/**
 * Is this node worth a slot in the budget? Layout divs with no direct text are the
 * bulk of any real page and carry no information the server can act on.
 */
function isInteresting(el: Element, role: ElementRole): boolean {
  // A <label> is never interesting in its own right: its text is already reported as
  // the accessible name of the control it labels. Keeping it duplicates every form
  // field in the tree, inflates the node budget, and makes the same value get scanned
  // for PII twice. Found by bench fixture 01.
  if (el.tagName.toLowerCase() === 'label') return false;

  if (INTERACTIVE_ROLES.has(role)) return true;
  if (role === 'heading' || role === 'image' || role === 'canvas' || role === 'iframe') return true;
  if (directText(el).length > 0) return true;

  // An explicit aria-label or role is the author DECLARING that this element carries
  // meaning. Pruning it discards information the page went out of its way to provide.
  // Found by Spike C: every block on the alignment fixture was silently dropped,
  // because a labelled <div> with no text hits none of the rules above.
  if (el.hasAttribute('aria-label') || el.hasAttribute('role')) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Signals for PII layer 1
// ---------------------------------------------------------------------------

/**
 * Text from the nearest preceding sibling, or the row header in a table.
 *
 * HTML has no markup for the label:value pair that pages use constantly, so a value
 * cell arrives as naked digits with all its meaning sitting in the neighbour. Without
 * this, "<td>Order Total</td><td>999999999999</td>" reads as an unlabelled Aadhaar.
 * Pure structural markup, so it does not breach the no-site-specific-logic rule.
 */
function contextLabelFor(el: Element): string | undefined {
  const prev = el.previousElementSibling;
  const prevText = prev ? directText(prev) : '';
  if (prevText) return prevText.slice(0, 100);

  // Table cells: fall back to the first cell of the row.
  const row = el.closest('tr');
  const firstCell = row?.firstElementChild;
  if (firstCell && firstCell !== el) {
    const text = directText(firstCell);
    if (text) return text.slice(0, 100);
  }
  return undefined;
}

/** Everything `pii/dom.ts#classifyField` needs, pulled once. */
export function signalsFor(el: Element): FieldSignals {
  return {
    contextLabel: contextLabelFor(el),
    tag: el.tagName.toLowerCase(),
    type: (el as HTMLInputElement).type?.toLowerCase(),
    autocomplete: el.getAttribute('autocomplete') ?? undefined,
    name: el.getAttribute('name') ?? undefined,
    id: el.id || undefined,
    label: accessibleName(el),
    placeholder: el.getAttribute('placeholder') ?? undefined,
    ariaLabel: el.getAttribute('aria-label') ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

export interface ExtractOptions {
  /** Hard cap. Protects the 20% resource score on heavy pages. */
  maxNodes?: number;
  /** Keep offscreen-but-rendered nodes. Off by default — the agent acts on what is seen. */
  includeOffscreen?: boolean;
}

export interface ExtractResult {
  structure: PageStructure;
  /** True when the budget was hit. Surfaced to the server so it knows the view is partial. */
  truncated: boolean;
  nodeCount: number;
  /** Elements the ViT must inspect, in document order. */
  visionQueue: ElementId[];
}

export function extractPage(doc: Document, opts: ExtractOptions = {}): ExtractResult {
  const maxNodes = opts.maxNodes ?? 1500;
  const includeOffscreen = opts.includeOffscreen ?? false;
  const viewport = {
    w: doc.defaultView?.innerWidth ?? 0,
    h: doc.defaultView?.innerHeight ?? 0,
    scrollX: doc.defaultView?.scrollX ?? 0,
    scrollY: doc.defaultView?.scrollY ?? 0,
  };

  let count = 0;
  let truncated = false;
  const visionQueue: ElementId[] = [];

  function walk(el: Element): ElementNode | null {
    if (count >= maxNodes) { truncated = true; return null; }
    if (SKIP_TAGS.has(el.tagName.toLowerCase())) return null;

    // Genuinely hidden subtrees are skipped wholesale: a closed menu holds hundreds of
    // nodes the user cannot see and the agent must not act on.
    if (isHidden(el)) return null;

    const box = boxOf(el);
    const visible = hasSize(box);

    if (!includeOffscreen) {
      const offscreen = box.y + box.h < 0 || box.y > viewport.h
        || box.x + box.w < 0 || box.x > viewport.w;
      // Descend anyway — a scrolled-out container can still hold visible children.
      if (offscreen && el.childElementCount === 0) return null;
    }

    const role = roleOf(el);
    const children: ElementNode[] = [];
    for (const child of Array.from(el.children)) {
      const node = walk(child);
      if (node) children.push(node);
    }

    // A zero-size element carries nothing itself, but may be the container holding
    // everything that matters. Pass its children up rather than dropping them.
    if (!visible && children.length === 0) return null;
    if (!visible && children.length === 1) return children[0];

    // Keep a node if it carries information itself, or if it is holding up children
    // that do. Otherwise collapse it away and splice its children upward.
    if (!isInteresting(el, role) && children.length === 0) return null;
    if (!isInteresting(el, role) && children.length === 1) return children[0];

    count++;
    const id = idFor(el);
    if (needsVision(el)) visionQueue.push(id);

    const value = (el as HTMLInputElement).value;
    const label = accessibleName(el);
    // Only when it differs: for a labelled <input> the preceding sibling IS the label,
    // and repeating it on every node would inflate the payload for nothing.
    const context = contextLabelFor(el);
    return {
      id,
      role,
      label,
      contextLabel: context && context !== label ? context : undefined,
      // Raw value. The sanitizer decides what happens to it, never the extractor.
      value: typeof value === 'string' && value.length > 0 ? value : undefined,
      box,
      visible,
      enabled: isEnabled(el),
      required: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true' || undefined,
      focused: el === doc.activeElement || undefined,
      autocomplete: el.getAttribute('autocomplete') ?? undefined,
      needsVision: needsVision(el) || undefined,
      children: children.length ? children : undefined,
    };
  }

  const root = walk(doc.body) ?? {
    id: idFor(doc.body), role: 'other' as ElementRole,
    box: { x: 0, y: 0, w: viewport.w, h: viewport.h },
    visible: true, enabled: true,
  };

  return {
    structure: {
      url: doc.location.href,
      title: doc.title,
      capturedAt: Date.now(),
      viewport,
      root,
    },
    truncated,
    nodeCount: count,
    visionQueue,
  };
}
