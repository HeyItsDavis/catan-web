/**
 * More of the base game through the real UI: city upgrade, Knight (robber + steal),
 * Road Building, Monopoly, in-game chat, and winning (game-over screen on both sides).
 */
import { expect, test } from '@playwright/test';
import {
  clickHighlight, copyInviteLink, createRoom, hook, hostGame, joinViaLink, newPlayer, shot, type GameLite, type Player, closePlayers } from './helpers';

test.afterEach(closePlayers);

test('dev cards, city, chat and the end of the game', async ({ browser }) => {
  const host = await newPlayer(browser, 'Ada');
  const guest = await newPlayer(browser, 'Bob');
  await createRoom(host);
  await joinViaLink(guest, await copyInviteLink(host));
  await host.page.locator('.setting-row', { hasText: 'Turn timer' }).locator('select').selectOption('180');
  await expect(guest.page.locator('.setting-row', { hasText: 'Turn timer' })).toContainText('180s');
  await guest.page.getByRole('button', { name: "I'm ready" }).click();
  await host.page.getByRole('button', { name: 'Start game' }).click();
  await expect(guest.page.locator('.g-root')).toBeVisible();
  // One host-driven countdown per screen.
  for (const p of [host, guest]) {
    await expect(p.page.getByRole('timer')).toHaveCount(1);
    await expect(p.page.getByRole('timer')).toHaveText(/[23]:\d\d/);
  }

  const g0 = await hostGame(host);
  const id: Record<string, string> = Object.fromEntries(g0.players.map((p) => [p.name, p.id]));
  const byId: Record<string, Player> = { [id.Ada]: host, [id.Bob]: guest };
  const changed = async (g: GameLite) => expect.poll(async () => (await hostGame(host)).version).toBeGreaterThan(g.version);

  for (let i = 0; i < 20; i++) {
    const g = await hostGame(host);
    if (g.phase !== 'setup') break;
    const pr = g.prompts[0];
    await clickHighlight(byId[pr.player], pr.options[0].startsWith('v:') ? 'vertex' : 'edge', i * 11 + 4);
    await changed(g);
  }
  const g1 = await hostGame(host);
  const A = byId[g1.turnOrder[g1.currentPlayerIndex]];
  const B = A === host ? guest : host;
  const aId = id[A.name], bId = id[B.name];
  const me = async (pid: string) => (await hostGame(host)).players.find((p) => p.id === pid)!;

  const pass = async (p: Player) => {
    await hook(host, 'forceNextRoll', 8);
    await p.page.getByRole('button', { name: 'Roll' }).click();
    await expect(p.page.locator('.g-dice-total')).toHaveText('8');
    await p.page.getByRole('button', { name: 'End turn' }).click();
    await expect(p.page.locator('.g-turn--mine')).toHaveCount(0);
  };

  await test.step('A buys three dev cards and builds a city', async () => {
    await hook(host, 'forceNextRoll', 8);
    await A.page.getByRole('button', { name: 'Roll' }).click();
    await hook(host, 'giveResources', aId, { wool: 3, grain: 5, ore: 6 });
    await hook(host, 'stackDeck', 'dev', ['knight', 'roadBuilding', 'monopoly']);
    for (let k = 0; k < 3; k++) {
      const g = await hostGame(host);
      await A.page.locator('.g-abtn[title^="Buy Development"]').click();
      await changed(g);
    }
    await expect(A.page.locator('.g-self .g-card')).toHaveCount(3);
    const g = await hostGame(host);
    await A.page.locator('.g-abtn[title^="City"]').click();
    await clickHighlight(A, 'vertex', 0);
    await changed(g);
    expect((await hostGame(host)).pieces.filter((p) => p.type === 'city' && p.owner === aId)).toHaveLength(1);
    await expect(B.page.locator('.g-piece title', { hasText: 'City' })).toHaveCount(1);
    await A.page.getByRole('button', { name: 'End turn' }).click();
  });

  await test.step('in-game chat', async () => {
    await B.page.getByRole('tab', { name: 'Chat' }).click();
    await B.page.locator('.g-logchat input').fill('nice city');
    await B.page.locator('.g-logchat input').press('Enter');
    await A.page.getByRole('tab', { name: 'Chat' }).click();
    await expect(A.page.locator('.g-logchat')).toContainText('nice city');
    await A.page.getByRole('tab', { name: 'Log' }).click();
  });

  await pass(B);

  await test.step('A plays a Knight before rolling: robber moves, steals from B', async () => {
    await hook(host, 'giveResources', bId, { brick: 2 });
    const g = await hostGame(host);
    const bBuilding = g.pieces.find((p) => p.owner === bId && p.type === 'settlement')!.at;
    await A.page.locator('.g-card--playable', { hasText: 'Knight' }).click();
    await expect.poll(async () => (await hostGame(host)).prompts[0]?.kind).toBe('location');
    const pr = (await hostGame(host)).prompts[0];
    const target = pr.options.find((h) => hexCorners(h).includes(bBuilding)) ?? pr.options[0];
    const before = Object.values((await me(bId)).resources).reduce((a, b) => a + b, 0);
    await A.page.locator(`.g-hl-hex[data-loc="${target}"]`).click({ force: true });
    await expect.poll(async () => (await hostGame(host)).tokens.robber).toBe(target);
    if ((await hostGame(host)).prompts[0]?.kind === 'player') {
      await A.page.getByRole('dialog').getByRole('button', { name: /Bob|Ada/ }).click();
      await expect.poll(async () => Object.values((await me(bId)).resources).reduce((a, b) => a + b, 0)).toBe(before - 1);
    }
    expect((await me(aId)).played.map((c) => c.card)).toContain('knight');
    await expect(B.page.locator('.g-opp')).toContainText('Knights played: 1');
    // One dev card per turn.
    await expect(A.page.locator('.g-card--playable')).toHaveCount(0);
    await pass(A);
  });

  await pass(B);

  await test.step('A plays Road Building: two free roads', async () => {
    await hook(host, 'forceNextRoll', 8);
    await A.page.getByRole('button', { name: 'Roll' }).click();
    const roads = (await hostGame(host)).pieces.filter((p) => p.type === 'road' && p.owner === aId).length;
    await A.page.locator('.g-card--playable', { hasText: 'Road Building' }).click();
    for (let k = 0; k < 2; k++) {
      const g = await hostGame(host);
      expect(g.prompts[0]?.kind).toBe('location');
      await clickHighlight(A, 'edge', 0);
      await changed(g);
    }
    expect((await hostGame(host)).pieces.filter((p) => p.type === 'road' && p.owner === aId)).toHaveLength(roads + 2);
    await A.page.getByRole('button', { name: 'End turn' }).click();
  });

  await pass(B);

  await test.step('A plays Monopoly on wool', async () => {
    await hook(host, 'giveResources', bId, { wool: 3 });
    await hook(host, 'forceNextRoll', 8);
    await A.page.getByRole('button', { name: 'Roll' }).click();
    const bWool = (await me(bId)).resources.wool, aWool = (await me(aId)).resources.wool;
    await A.page.locator('.g-card--playable', { hasText: 'Monopoly' }).click();
    await A.page.getByRole('dialog').getByRole('button', { name: /Wool/ }).click();
    await expect.poll(async () => (await me(bId)).resources.wool).toBe(0);
    expect((await me(aId)).resources.wool).toBe(aWool + bWool);
  });

  await test.step('A reaches the target and wins; both see the game-over screen', async () => {
    await hook(host, 'setTokenVP', aId, 20);
    const g = await hostGame(host);
    await hook(host, 'giveResources', aId, { brick: 1, lumber: 1 });
    // The win is checked after every command, so the next action ends the game.
    await A.page.locator('.g-abtn[title^="Road"]').click();
    await changed(g);
    const end = await hostGame(host);
    expect(end.phase).toBe('gameOver');
    for (const p of [A, B]) await expect(p.page.getByRole('dialog', { name: 'Game over' })).toBeVisible();
    await shot(B, 'game-over');
  });

  expect(host.errors).toEqual([]);
  expect(guest.errors).toEqual([]);
});

/** Corner vertex ids of hex `h:q,r` (mirrors engine/board/topology.ts hexCorners). */
function hexCorners(hex: string): string[] {
  const [q, r] = hex.slice(2).split(',').map(Number);
  return [`v:${q},${r},N`, `v:${q + 1},${r - 1},S`, `v:${q},${r + 1},N`, `v:${q},${r},S`, `v:${q - 1},${r + 1},N`, `v:${q},${r - 1},S`];
}
