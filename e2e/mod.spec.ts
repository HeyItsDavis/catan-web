/**
 * Modding end to end: build a mod in the editor UI (new resource, a building, a recipe action,
 * a card in a new deck), save it, enable it in a room, and use the custom content in a game.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  clickHighlight, copyInviteLink, createRoom, hook, hostGame, joinViaLink, newPlayer, shot, type Player,
} from './helpers';

async function openTab(page: Page, name: string) {
  await page.locator('.me-tab', { hasText: name }).click();
}

async function rename(page: Page, path: string, name: string) {
  await page.locator(`.me-coll-form [data-path="${path}"] input`).fill(name);
}

test('make a mod in the editor and play it with a friend', async ({ browser }) => {
  const host = await newPlayer(browser, 'Ada');
  const guest = await newPlayer(browser, 'Bob');
  const page = host.page;

  await test.step('build the mod in the editor', async () => {
    await page.goto('/#/editor');
    await page.getByRole('button', { name: /Create your first mod/ }).click();
    await page.locator('[data-path="meta.name"] input').fill('Spice Trade');

    await openTab(page, 'Resources');
    await page.getByRole('button', { name: '✦ Resource + terrain' }).click();
    await rename(page, 'resources[0].name', 'Spice');

    await openTab(page, 'Pieces');
    await page.getByRole('button', { name: '✦ Building with recipe' }).click();
    await rename(page, 'pieces[0].name', 'Bazaar');

    await openTab(page, 'Actions');
    await page.getByRole('button', { name: '✦ Recipe action' }).click();
    await rename(page, 'actions[0].name', 'Brew Tea');

    await openTab(page, 'Decks');
    await page.getByRole('button', { name: '✦ Deck' }).click();
    await rename(page, 'decks[0].name', 'Spice Deck');

    await openTab(page, 'Cards');
    await page.getByRole('button', { name: '✦ Development card' }).click();
    await rename(page, 'cards[0].name', 'Windfall');
    await page.locator('.me-coll-form select', { hasText: 'Add to deck…' }).selectOption({ label: 'Spice Deck' });
    await expect(page.locator('.me-coll-form')).toContainText('Spice Deck ×1');

    await openTab(page, 'Settings');
    await page.getByRole('button', { name: '✦ On/off setting' }).click();
    await rename(page, 'settings[0].name', 'Spicy mode');

    await expect(page.locator('.me-save')).toContainText('Saved', { timeout: 5000 });
    await expect(page.locator('.me-issues-btn')).toContainText('No problems');
    await shot(host, 'mod-editor-done');

    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('catanweb:mods') ?? '[]'));
    const mod = saved.find((e: { mod: { meta: { id: string } } }) => e.mod.meta.id === 'spice-trade')?.mod;
    expect(mod, 'mod saved under its new id').toBeTruthy();
    expect(mod.resources[0]).toMatchObject({ id: 'spice', name: 'Spice' });
    expect(mod.terrains[0].produces).toEqual({ spice: 1 }); // reference followed the rename
    expect(mod.decks[0]).toMatchObject({ id: 'spice-deck', cards: [{ card: 'windfall', count: 1 }] });
    expect(mod.actions[0]).toMatchObject({ id: 'brew-tea', name: 'Brew Tea' });
    expect(mod.settings[0]).toMatchObject({ id: 'spicy-mode', type: 'boolean' });

    // Export downloads the same JSON.
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export/ }).first().click();
    const file = await (await download).path();
    const exported = JSON.parse((await import('node:fs')).readFileSync(file, 'utf8'));
    expect(exported.meta.id).toBe('spice-trade');
  });

  await test.step('host enables the mod in a room; guest sees it', async () => {
    await createRoom(host);
    const link = await copyInviteLink(host);
    await joinViaLink(guest, link);
    await page.getByRole('tab', { name: /Mods/ }).click();
    const lib = page.locator('.mod-library .mod-row', { hasText: 'Spice Trade' });
    await expect(lib).toBeVisible();
    await lib.getByRole('button', { name: 'Add' }).click();
    await expect(page.locator('.mod-list')).toContainText('Spice Trade');
    await guest.page.getByRole('tab', { name: /Mods/ }).click();
    await expect(guest.page.locator('.mod-list')).toContainText('Spice Trade');
    // The mod's lobby setting shows up for both; the host flips it.
    await page.getByRole('tab', { name: 'Game settings' }).click();
    await guest.page.getByRole('tab', { name: 'Game settings' }).click();
    const spicy = (pg: typeof page) => pg.locator('.setting-row', { hasText: 'Spicy mode' }).getByRole('switch');
    await expect(spicy(guest.page)).toHaveAttribute('aria-checked', 'false');
    await spicy(page).click();
    await expect(spicy(guest.page)).toHaveAttribute('aria-checked', 'true');
    await guest.page.getByRole('button', { name: "I'm ready" }).click();
    await page.getByRole('button', { name: 'Start game' }).click();
    await expect(guest.page.locator('.g-root')).toBeVisible();
  });

  const g0 = await hostGame(host);
  const id: Record<string, string> = Object.fromEntries(g0.players.map((p) => [p.name, p.id]));
  const byId: Record<string, Player> = { [id.Ada]: host, [id.Bob]: guest };

  await test.step('custom content is visible to both players', async () => {
    for (const p of [host, guest]) {
      await expect(p.page.locator('.g-hand-res', { hasText: 'Spice' })).toBeVisible();
      await expect(p.page.locator('.g-abtn[title^="Bazaar"]')).toBeVisible();
      await expect(p.page.locator('.g-abtn[title^="Buy Spice Deck"]')).toBeVisible();
    }
    await shot(guest, 'mod-game-guest');
  });

  await test.step('setup, then the guest uses the recipe on their turn', async () => {
    for (let i = 0; i < 20; i++) {
      const g = await hostGame(host);
      if (g.phase !== 'setup') break;
      const pr = g.prompts[0];
      await clickHighlight(byId[pr.player], pr.options[0].startsWith('v:') ? 'vertex' : 'edge', i * 5 + 1);
      await expect.poll(async () => (await hostGame(host)).version).toBeGreaterThan(g.version);
    }
    // If the host goes first, play a quick turn.
    let g = await hostGame(host);
    if (g.turnOrder[g.currentPlayerIndex] === id.Ada) {
      await hook(host, 'forceNextRoll', 8);
      await page.getByRole('button', { name: 'Roll' }).click();
      await page.getByRole('button', { name: 'End turn' }).click();
    }
    await expect(guest.page.locator('.g-turn--mine')).toBeVisible();
    // The recipe costs the first two base resources (brick + lumber); hand them out.
    await hook(host, 'giveResources', id.Bob, { brick: 2, lumber: 2 });
    const brew = guest.page.locator('.g-abtn[title^="Brew Tea"]');
    await expect(brew).toBeDisabled(); // must roll first
    await hook(host, 'forceNextRoll', 8);
    await guest.page.getByRole('button', { name: 'Roll' }).click();
    await expect(brew).toBeEnabled();
    const vpBefore = (await hostGame(host)).players.find((p) => p.id === id.Bob) as unknown as { tokenVP: number };
    await brew.click();
    await expect.poll(async () => ((await hostGame(host)).players.find((p) => p.id === id.Bob) as unknown as { tokenVP: number }).tokenVP)
      .toBe(vpBefore.tokenVP + 1);
    await expect(brew).toBeDisabled(); // limit 1 per turn
    await expect(page.locator('.g-log')).toContainText('Brew Tea');
    g = await hostGame(host);
    expect(g.players.find((p) => p.id === id.Bob)!.resources.brick).toBeGreaterThanOrEqual(0);
    await shot(guest, 'mod-recipe-used');
  });

  expect(host.errors).toEqual([]);
  expect(guest.errors).toEqual([]);
});

test('upload a mod file in the lobby', async ({ browser }) => {
  const host = await newPlayer(browser, 'Ada');
  const guest = await newPlayer(browser, 'Bob');
  await createRoom(host);
  await joinViaLink(guest, await copyInviteLink(host));
  await host.page.getByRole('tab', { name: /Mods/ }).click();
  await host.page.locator('.mods input[type=file]').setInputFiles('e2e/fixtures/harvest-festival.json');
  await expect(host.page.locator('.mod-list')).toContainText('Harvest Festival');
  // The mod's VP target becomes the room default.
  await host.page.getByRole('tab', { name: 'Game settings' }).click();
  await expect(guest.page.locator('.setting-row', { hasText: 'Points to win' })).toContainText('12');
  await guest.page.getByRole('button', { name: "I'm ready" }).click();
  await host.page.getByRole('button', { name: 'Start game' }).click();
  for (const p of [host, guest]) await expect(p.page.locator('.g-abtn[title^="Hold a festival"]')).toBeVisible();
  // Uploaded mods are kept in the uploader's library.
  const lib = await host.page.evaluate(() => localStorage.getItem('catanweb:mods') ?? '');
  expect(lib).toContain('harvest-festival');
  expect(host.errors).toEqual([]);
  expect(guest.errors).toEqual([]);
});
