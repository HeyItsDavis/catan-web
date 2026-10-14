import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

export const SHOTS = 'e2e/.shots';

export interface Player {
  ctx: BrowserContext;
  page: Page;
  name: string;
  errors: string[];
}

/** A fresh browser context (separate localStorage = separate player identity). */
export async function newPlayer(browser: Browser, name: string, opts: { viewport?: { width: number; height: number } } = {}): Promise<Player> {
  const ctx = await browser.newContext({
    viewport: opts.viewport ?? { width: 1400, height: 900 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('dialog', (d) => void d.accept());
  return { ctx, page, name, errors };
}

/** Host: enter name on the home page and create a room. Returns the room code. */
export async function createRoom(p: Player, path = '/'): Promise<string> {
  await p.page.goto(path);
  await p.page.getByLabel('Your name').fill(p.name);
  await p.page.getByRole('button', { name: 'Create room' }).click();
  await p.page.waitForURL(/#\/room\/[A-Z0-9]{6}$/);
  const code = /#\/room\/([A-Z0-9]{6})/.exec(p.page.url())![1];
  // The room is reachable once the "Opening room…" banner is gone.
  await expect(p.page.getByText('Opening room to the internet')).toHaveCount(0, { timeout: 60_000 });
  await expect(p.page.getByRole('heading', { name: /Players/ })).toBeVisible();
  return code;
}

/** Copy the invite link through the real button + clipboard. */
export async function copyInviteLink(p: Player): Promise<string> {
  await p.page.getByRole('button', { name: /Copy invite link/ }).click();
  await expect(p.page.getByRole('button', { name: /Link copied/ })).toBeVisible();
  return p.page.evaluate(() => navigator.clipboard.readText());
}

/** Guest: open an invite link and enter a name. */
export async function joinViaLink(p: Player, link: string): Promise<void> {
  await p.page.goto(link);
  await p.page.getByLabel('Your name').fill(p.name);
  await p.page.getByRole('button', { name: 'Join' }).click();
  await expect(p.page.getByRole('heading', { name: /Players/ })).toBeVisible({ timeout: 90_000 });
}

export async function shot(p: Player, name: string): Promise<void> {
  await p.page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/** Run a test hook in the host page. */
export async function hook<T>(host: Player, fn: string, ...args: unknown[]): Promise<T> {
  return host.page.evaluate(
    ([f, a]) => {
      const h = (window as unknown as { __hexlands: Record<string, (...x: unknown[]) => unknown> }).__hexlands;
      if (!h) throw new Error('test hooks not installed');
      return h[f as string](...(a as unknown[])) as T;
    },
    [fn, args] as const,
  );
}

/** Authoritative game state (host only). */
export async function hostGame(host: Player): Promise<GameLite> {
  return host.page.evaluate(() => (window as unknown as { __hexlands: { game: () => unknown } }).__hexlands.game() as GameLite);
}

/** Subset of GameState used by tests (e2e doesn't import app code). */
export interface GameLite {
  version: number;
  phase: string;
  turn: number;
  hasRolled: boolean;
  currentPlayerIndex: number;
  turnOrder: string[];
  players: { id: string; name: string; resources: Record<string, number>; hand: { id: string; card: string }[]; played: { card: string }[] }[];
  pieces: { id: string; type: string; owner: string; at: string }[];
  prompts: { id: string; player: string; kind: string; label: string; options: string[] }[];
  trades: { id: string }[];
  tokens: Record<string, string | null>;
  lastRoll: { total: number } | null;
  log: { text: string }[];
}

/** Host-side lobby players (with live `connected` flags). */
export async function hostLobbyPlayers(host: Player): Promise<{ id: string; name: string; connected: boolean }[]> {
  return host.page.evaluate(() =>
    (window as unknown as { __hexlands: { lobby: () => { players: { id: string; name: string; connected: boolean }[] } } }).__hexlands.lobby().players);
}

export async function currentPlayerName(host: Player): Promise<string> {
  const g = await hostGame(host);
  const id = g.turnOrder[g.currentPlayerIndex];
  return g.players.find((p) => p.id === id)!.name;
}

/** Click a highlighted board spot (index modulo the number of spots) of a kind ('vertex' | 'edge' | 'hex'). */
export async function clickHighlight(p: Player, kind: 'vertex' | 'edge' | 'hex', index = 0): Promise<void> {
  const all = p.page.locator(`.g-hl-${kind}`);
  // (vertical edges have a zero-width bounding box, so don't use toBeVisible here)
  await expect.poll(() => all.count()).toBeGreaterThan(0);
  const n = await all.count();
  await all.nth(index % n).click({ force: true });
}

export function sum(m: Record<string, number>): number {
  return Object.values(m).reduce((a, b) => a + b, 0);
}
