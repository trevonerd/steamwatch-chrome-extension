// ─────────────────────────────────────────────────────────────────────────────
// SteamWatch — src/utils/html.ts
// DOM helpers. All user/API data must be escaped before HTML insertion.
// ─────────────────────────────────────────────────────────────────────────────

/** Escape a string for safe insertion into HTML content or attributes. */
export function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

type Child = Node | string | number | null | undefined | false;

interface HtmlOptions {
  className?: string;
  text?: string | number;
  attrs?: Record<string, string | number | boolean | null | undefined>;
  dataset?: Record<string, string | number | boolean | null | undefined>;
  children?: readonly Child[];
}

interface SvgOptions {
  className?: string;
  text?: string | number;
  attrs?: Record<string, string | number | boolean | null | undefined>;
  children?: readonly Child[];
}

/** Get a typed element by id. Throws if missing — catches config errors early. */
export function mustGet<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`[SteamWatch] Element #${id} not found in DOM.`);
  return el as T;
}

export function clear(el: Element): void {
  el.replaceChildren();
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: HtmlOptions = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  applyHtmlOptions(node, options);
  return node;
}

export function s<K extends keyof SVGElementTagNameMap>(
  tag: K,
  options: SvgOptions = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  applySvgOptions(node, options);
  return node;
}

export function append(parent: Node, ...children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(
      child instanceof Node
        ? child
        : document.createTextNode(String(child)),
    );
  }
}

function applyHtmlOptions(node: HTMLElement, options: HtmlOptions): void {
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = String(options.text);
  applyAttributes(node, options.attrs);
  if (options.dataset) {
    for (const [key, value] of Object.entries(options.dataset)) {
      if (value === null || value === undefined) continue;
      node.dataset[key] = String(value);
    }
  }
  if (options.children) append(node, ...options.children);
}

function applySvgOptions(node: SVGElement, options: SvgOptions): void {
  if (options.className) node.setAttribute("class", options.className);
  if (options.text !== undefined) node.textContent = String(options.text);
  applyAttributes(node, options.attrs);
  if (options.children) append(node, ...options.children);
}

function applyAttributes(
  node: Element,
  attrs: Record<string, string | number | boolean | null | undefined> | undefined,
): void {
  if (!attrs) return;
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (value === true) {
      node.setAttribute(key, "");
      continue;
    }
    node.setAttribute(key, String(value));
  }
}

/**
 * Show an element.
 * Removes both the HTML `hidden` attribute and any inline display override.
 * The element's visible state is then determined entirely by CSS, as intended.
 */
export function show(el: HTMLElement): void {
  el.removeAttribute("hidden");
  el.style.removeProperty("display");
}

/**
 * Hide an element.
 * Sets the HTML `hidden` attribute (semantic + CSS `display:none` from UA
 * stylesheet) AND an inline override so the element stays hidden even if CSS
 * is partially overriding the attribute.
 */
export function hide(el: HTMLElement): void {
  el.setAttribute("hidden", "");
  el.style.setProperty("display", "none", "important");
}

/** Toggle a CSS class based on a condition. */
export function toggleClass(el: HTMLElement, cls: string, condition: boolean): void {
  el.classList.toggle(cls, condition);
}
