/** JSON paths like `cards[2].effect[0].do[1].piece`, plus immutable get/set helpers. */

export type Seg = string | number;
export type Path = Seg[];

export function formatPath(path: Path): string {
  let s = '';
  for (const seg of path) {
    if (typeof seg === 'number') s += `[${seg}]`;
    else s += s ? `.${seg}` : seg;
  }
  return s;
}

/** Accepts `a.b[0].c`, `a/b/0/c`, `/a/b/0`, `a.b.0.c`. Numeric segments become numbers. */
export function parsePath(str: string): Path {
  const cleaned = str.replace(/^\$\.?/, '').replace(/^\//, '');
  const parts = cleaned.split(/[./]|\[|\]/).filter(p => p !== '');
  return parts.map(p => (/^\d+$/.test(p) ? Number(p) : p));
}

export function getIn(obj: unknown, path: Path): unknown {
  let cur: unknown = obj;
  for (const seg of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[seg];
  }
  return cur;
}

/** Immutable set. Creates objects/arrays as needed. `undefined` deletes object keys. */
export function setIn<T>(obj: T, path: Path, value: unknown): T {
  if (path.length === 0) return value as T;
  const [head, ...rest] = path;
  const container: Record<string | number, unknown> | unknown[] =
    Array.isArray(obj) ? [...obj] : obj && typeof obj === 'object' ? { ...(obj as object) } as Record<string, unknown> : typeof head === 'number' ? [] : {};
  const child = (container as Record<string | number, unknown>)[head];
  const next = setIn(child, rest, value);
  if (next === undefined && !Array.isArray(container)) delete (container as Record<string, unknown>)[head as string];
  else (container as Record<string | number, unknown>)[head] = next;
  return container as T;
}

export function isPrefix(prefix: Path, path: Path): boolean {
  if (prefix.length > path.length) return false;
  return prefix.every((s, i) => String(s) === String(path[i]));
}

/** Lowercase kebab id from a display name. */
export function slugify(name: string): string {
  return name
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function uniqueId(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  const b = base || 'item';
  if (!set.has(b)) return b;
  for (let i = 2; ; i++) if (!set.has(`${b}-${i}`)) return `${b}-${i}`;
}
