// Petit utilitaire de création d'éléments DOM (sans framework).

type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, unknown> & {
  class?: string;
  style?: string | Partial<CSSStyleDeclaration>;
  on?: Partial<Record<keyof HTMLElementEventMap, (e: Event) => void>>;
};

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style') {
        if (typeof v === 'string') el.setAttribute('style', v);
        else Object.assign(el.style, v);
      } else if (k === 'on') {
        for (const [ev, fn] of Object.entries(v as Record<string, (e: Event) => void>)) el.addEventListener(ev, fn);
      } else if (k === 'html') el.innerHTML = String(v);
      else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function $(sel: string, root: ParentNode = document): HTMLElement | null {
  return root.querySelector(sel) as HTMLElement | null;
}
