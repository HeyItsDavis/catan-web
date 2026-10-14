/**
 * The guest plays on a phone-sized screen (390×844, touch): lobby, setup placement by tapping
 * the board, rolling, trading dialog and a discard. Screenshots go to e2e/.shots/phone-*.png.
 */
import { expect, test } from '@playwright/test';
import { copyInviteLink, createRoom, hook, hostGame, joinViaLink, newPlayer, shot, type Player, closePlayers } from './helpers';

test.afterEach(closePlayers);

test('guest on a phone can play', async ({ browser }) => {
  const host = await newPlayer(browser, 'Ada');
  const guest = await newPlayer(browser, 'Bob', { viewport: { width: 390, height: 844 } });

  await createRoom(host);
  await joinViaLink(guest, await copyInviteLink(host));
  await shot(guest, 'phone-lobby');
  await guest.page.getByRole('button', { name: "I'm ready" }).click();
  await host.page.getByRole('button', { name: 'Start game' }).click();
  await expect(guest.page.locator('.g-root')).toBeVisible();
  await shot(guest, 'phone-game-start');

  const g0 = await hostGame(host);
  const id: Record<string, string> = Object.fromEntries(g0.players.map((p) => [p.name, p.id]));
  const byId: Record<string, Player> = { [id.Ada]: host, [id.Bob]: guest };

  for (let i = 0; i < 20; i++) {
    const g = await hostGame(host);
    if (g.phase !== 'setup') break;
    const pr = g.prompts[0];
    const p = byId[pr.player];
    const loc = p.page.locator(`[data-loc="${pr.options[(i * 7 + 2) % pr.options.length]}"]`);
    if (p === guest) {
      if (i < 4) await shot(guest, `phone-setup-${i}`);
      // A real tap on the highlighted spot, which must be on screen.
      const box = await loc.boundingBox();
      expect(box, 'highlight is rendered').toBeTruthy();
      const vp = guest.page.viewportSize()!;
      const x = box!.x + box!.width / 2, y = box!.y + box!.height / 2;
      expect(x >= 0 && x <= vp.width && y >= 0 && y <= vp.height, `spot ${x},${y} on screen`).toBe(true);
      await guest.page.mouse.click(x, y);
    } else {
      await loc.click({ force: true });
    }
    await expect.poll(async () => (await hostGame(host)).version).toBeGreaterThan(g.version);
  }

  let g = await hostGame(host);
  if (g.turnOrder[g.currentPlayerIndex] === id.Ada) {
    await hook(host, 'forceNextRoll', 8);
    await host.page.getByRole('button', { name: 'Roll' }).click();
    await host.page.getByRole('button', { name: 'End turn' }).click();
  }
  await hook(host, 'giveResources', id.Bob, { brick: 3, lumber: 3, wool: 2, grain: 2, ore: 2 });
  await hook(host, 'forceNextRoll', 8);
  const roll = guest.page.getByRole('button', { name: 'Roll' });
  await roll.scrollIntoViewIfNeeded();
  await roll.click();
  await expect(guest.page.locator('.g-dice-total')).toHaveText('8');
  await shot(guest, 'phone-after-roll');

  await guest.page.getByRole('button', { name: /^Trade/ }).first().click();
  await expect(guest.page.getByRole('dialog', { name: 'Trade' })).toBeVisible();
  await shot(guest, 'phone-trade');
  await guest.page.getByRole('dialog', { name: 'Trade' }).getByRole('button', { name: 'Close' }).click();
  await guest.page.getByRole('button', { name: 'End turn' }).click();

  // A 7 on the host's turn makes the phone player discard.
  await hook(host, 'giveResources', id.Bob, { grain: 6 });
  await hook(host, 'forceNextRoll', 7);
  await host.page.getByRole('button', { name: 'Roll' }).click();
  const dlg = guest.page.getByRole('dialog');
  await expect(dlg).toBeVisible();
  await shot(guest, 'phone-discard');
  const btn = dlg.getByRole('button', { name: /^Discard \d+\/\d+$/ });
  for (let k = 0; k < 40 && !(await btn.isEnabled()); k++) {
    const more = dlg.getByRole('button', { name: 'more' });
    for (let j = 0; j < (await more.count()); j++) if (await more.nth(j).isEnabled()) { await more.nth(j).click(); break; }
  }
  await btn.click();
  await expect.poll(async () => (await hostGame(host)).prompts.filter((p) => p.player === id.Bob).length).toBe(0);
  g = await hostGame(host);
  expect(g.prompts.every((p) => p.player === id.Ada)).toBe(true);

  expect(guest.errors).toEqual([]);
  expect(host.errors).toEqual([]);
});
