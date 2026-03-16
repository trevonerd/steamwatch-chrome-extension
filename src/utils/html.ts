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

/** Get a typed element by id. Throws if missing — catches config errors early. */
export function mustGet<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`[SteamWatch] Element #${id} not found in DOM.`);
  return el as T;
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
