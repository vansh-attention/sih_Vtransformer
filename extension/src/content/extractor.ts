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
import { classifyField, type FieldSignals } from '../pii/dom.ts';

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
  // Same reason as above: iterate the live list rather than snapshotting it.
  for (let node = el.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === Node.TEXT_NODE) out += node.textContent ?? '';
  }
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * id -> associated <label> text, built once per `extractPage` call.
 *
 * Module-scoped rather than threaded through every caller: `accessibleName` is reached
 * from several places and passing a map through all of them would obscure what they do.
 */
let labelForId = new Map<string, string>();

function buildLabelIndex(doc: Document): Map<string, string> {
  const map = new Map<string, string>();
  for (const label of doc.querySelectorAll('label[for]')) {
    const target = label.getAttribute('for');
    if (!target || map.has(target)) continue;   // first label wins, as the DOM does
    const text = label.textContent?.replace(/\s+/g, ' ').trim();
    if (text) map.set(target, text);
  }
  return map;
}

/**
 * Accessible name, plus WHERE it came from.
 *
 * The provenance matters. When the name is borrowed — aria-label, a <label for>, a
 * placeholder — it is CONTEXT describing something else, and must survive redaction so
 * the server can still read the page. When it is the element's own text, it IS the
 * content, and redacting it wholesale is correct.
 *
 * Conflating the two let "<span>Priya Raghunathan</span>" reach the server unredacted:
 * it was treated as a label, and labels only ever get demotion-only hints so that
 * "Aadhaar Number" is not blanked into a token. Found by bench/score.ts.
 */
function accessibleNameDetailed(el: Element): { text: string; fromOwnText: boolean } | undefined {
  const borrowed = borrowedName(el);
  if (borrowed) return { text: borrowed, fromOwnText: false };
  const own = directText(el);
  // Cap: a name is a label, not a paragraph.
  return own ? { text: own.slice(0, 200), fromOwnText: true } : undefined;
}

function accessibleName(el: Element): string | undefined {
  return accessibleNameDetailed(el)?.text;
}

/** Names borrowed from elsewhere, in the order the ARIA spec resolves them. */
function borrowedName(el: Element): string | undefined {
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

  // O(1) lookup in a map built ONCE per extraction. Both obvious alternatives are
  // per-element document scans and both are quadratic on a large page:
  //   document.querySelector(`label[for="${id}"]`)  — 54s for 1500 calls
  //   element.labels                                — 10ms per call under jsdom
  // `.labels` is a fast native accessor in real browsers but not in every environment,
  // and a design that is only fast on some hosts is not a design.
  if (el.id) {
    const text = labelForId.get(el.id);
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

  return undefined;
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

const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'meta', 'link', 'head',
  'template', 'br',
  // Options travel on their <select> as `options`, not as nodes of their own.
  'option', 'optgroup']);

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
  // Borrowed text must come from something the USER CAN SEE.
  //
  // Without this check a `display:none` block adjacent to a visible element had its
  // text lifted into that element's contextLabel and shipped to the model — a working
  // prompt-injection channel that bypassed the visibility pruning entirely, because the
  // hidden node itself was correctly dropped while its text travelled anyway.
  // Found by bench/injection-test.ts.
  const visibleText = (node: Element | null | undefined): string => {
    if (!node || isHidden(node)) return '';
    return directText(node);
  };

  const prevText = visibleText(el.previousElementSibling);
  if (prevText) return prevText.slice(0, 100);

  // Table cells: fall back to the first cell of the row.
  const row = el.closest('tr');
  const firstCell = row?.firstElementChild;
  if (firstCell && firstCell !== el) {
    const text = visibleText(firstCell);
    if (text) return text.slice(0, 100);
  }

  // Finally, the nearest LABELLED ANCESTOR. A <div role="group" aria-label="Legal
  // name"> wrapping a bare <span>Priya Raghunathan</span> is standard SPA markup, and
  // the value has no label, no sibling and no row to describe it. Without this the
  // name reaches the server unredacted, because nothing ever looks upward.
  //
  // Bounded to 4 levels: beyond that the ancestor describes a whole section rather
  // than this field, and borrowing its label would mislabel everything inside it.
  // No isHidden() check on ancestors. This is only ever called for an element we have
  // already established is visible, and CSS guarantees the descendants of a hidden
  // element are hidden — so an ancestor of a visible element cannot be hidden. The
  // check was pure cost: getComputedStyle on up to 4 ancestors per node.
  let parent = el.parentElement;
  for (let depth = 0; parent && depth < 4; depth++, parent = parent.parentElement) {
    const aria = parent.getAttribute('aria-label')?.trim();
    if (aria) return aria.slice(0, 100);
  }

  return undefined;
}

/**
 * Everything `pii/dom.ts#classifyField` needs, pulled once.
 *
 * NOTE the use of `borrowedName`, not `accessibleName`. An element's OWN text must
 * never be evidence about what that text is — that reasoning is circular, and it is
 * destructive:
 *
 *   <td>Applicant Name</td>
 *
 * Its own text contains "name", so the classifier concludes the field holds a NAME, so
 * the sanitizer replaces the whole thing with <PII_NAME_1> — and the form's column
 * heading is gone. Every label cell in a table-layout form was being redacted this way,
 * which took redaction precision on the holdout to 22%.
 *
 * Evidence about a value has to come from somewhere OTHER than the value.
 */
export function signalsFor(el: Element, knownContext?: string): FieldSignals {
  return {
    // Reuse the caller's value when it has one. `walk` already computes this for the
    // node, and deriving it a second time doubled the sibling/ancestor scans — the
    // single largest cost in extraction on a large page.
    contextLabel: knownContext ?? contextLabelFor(el),
    tag: el.tagName.toLowerCase(),
    type: (el as HTMLInputElement).type?.toLowerCase(),
    autocomplete: el.getAttribute('autocomplete') ?? undefined,
    name: el.getAttribute('name') ?? undefined,
    id: el.id || undefined,
    label: borrowedName(el),
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

  // One document scan for all label[for] associations, instead of one per element.
  labelForId = buildLabelIndex(doc);

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
    // Sibling iteration, NOT Array.from(el.children). `children` is a live
    // HTMLCollection and snapshotting it allocates on every node visited; on a
    // 120,000-node page that measured 8644ms against 4ms for this loop.
    for (let child = el.firstElementChild; child; child = child.nextElementSibling) {
      const node = walk(child);
      if (node) children.push(node);
      // Stop the traversal outright once the budget is spent. Continuing to walk
      // costs real time for nodes that can never be kept — on a 120k-node page it
      // took extraction from 0.4s to 19s, because sibling iteration across 20,000
      // siblings is not free.
      if (count >= maxNodes) { truncated = true; break; }
    }

    // A zero-size element carries nothing itself, but may be the container holding
    // everything that matters. Pass its children up rather than dropping them.
    if (!visible && children.length === 0) return null;
    if (!visible && children.length === 1) return children[0];

    // Keep a node if it carries information itself, or if it is holding up children
    // that do. Otherwise collapse it away and splice its children upward.
    if (!isInteresting(el, role) && children.length === 0) return null;
    if (!isInteresting(el, role) && children.length === 1) return children[0];

    // Over budget AND carrying nothing: drop it. A node that is holding kept children
    // must survive, or the whole tree collapses to nothing the moment the budget is
    // reached — which is exactly what happened when this check was unconditional.
    if (count >= maxNodes && children.length === 0) { truncated = true; return null; }
    count++;
    const id = idFor(el);
    if (needsVision(el)) visionQueue.push(id);

    const named = accessibleNameDetailed(el);
    const domValue = (el as HTMLInputElement).value;

    // Own text is CONTENT and belongs in `value`; a borrowed name is CONTEXT and
    // belongs in `label`. Keeping them apart is what lets the sanitizer redact one
    // aggressively while protecting the other.
    //
    // EXCEPT for controls and headings, where the element's own text IS its accessible
    // name: a button reading "Save changes" is labelled "Save changes", not valued at
    // it. Filing that under `value` made the button vanish from the tree as far as the
    // server was concerned. Found by bench/score.ts.
    const ownTextIsLabel = role === 'button' || role === 'link' || role === 'heading';
    const ownText = named?.fromOwnText ? named.text : undefined;

    // A <select>'s children are <option>s: not page structure, and useless as tree
    // nodes, but essential as a list of what can be chosen.
    // Tag check, NOT `instanceof HTMLSelectElement`. That constructor is a browser
    // global and does not exist in the Node test environment, so the instanceof threw
    // ReferenceError and took out seven test suites at once.
    const options = el.tagName.toLowerCase() === 'select'
      ? Array.from((el as HTMLSelectElement).options)
          .filter((o) => o.value !== '')
          .slice(0, 40)
          .map((o) => ({ value: o.value, label: (o.textContent ?? '').trim().slice(0, 60) }))
      : undefined;

    const value = typeof domValue === 'string' && domValue.length > 0
      ? domValue
      : (ownTextIsLabel ? undefined : ownText);
    const label = named && !named.fromOwnText
      ? named.text
      : (ownTextIsLabel ? ownText : undefined);
    // Only when it differs: for a labelled <input> the preceding sibling IS the label,
    // and repeating it on every node would inflate the payload for nothing.
    const context = contextLabelFor(el);
    return {
      id,
      role,
      label,
      contextLabel: context && context !== label && context !== value ? context : undefined,
      // What layer 1 thinks this field is FOR. Not sensitive — a category, never a
      // value — and the validator needs it to refuse typing a PAN into a feedback box.
      //
      // Only computed for elements that can HOLD a value. Running the classifier on
      // every heading and paragraph doubled the per-node cost for a field that only
      // means anything on a control.
      options,
      fieldKind: INTERACTIVE_ROLES.has(role)
        ? (() => {
            const hint = classifyField(signalsFor(el, context));
            return hint && hint.kind !== 'NON_PII' ? hint.kind : undefined;
          })()
        : undefined,
      // Raw value. The sanitizer decides what happens to it, never the extractor.
      value,
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
