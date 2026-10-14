/**
 * Two friends play: host + guest in separate browser contexts over the real PeerJS broker.
 * Randomness (dice, dev deck) is steered through the dev-only test hooks (src/net/testHooks.ts);
 * every player action goes through the real UI.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  clickHighlight, copyInviteLink, createRoom, hook, hostGame, hostLobbyPlayers, joinViaLink, newPlayer, shot, type Player, closePlayers } from './helpers';

test.afterEach(closePlayers);

const settingRow = (page: Page, label: string) => page.locator('.setting-row', { hasText: label });

/** Answer every pending setup prompt by clicking highlighted spots. */
async function playSetup(host: Player, byId: Record<string, Player>): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const g = await hostGame(host);
    if (g.phase !== 'setup') return;
    const pr = g.prompts[0];
    expect(pr, 'setup should always have a prompt').toBeTruthy();
    expect(pr.kind).toBe('location');
    const p = byId[pr.player];
    // The other player sees a "waiting for" line meanwhile.
    await clickHighlight(p, pr.options[0].startsWith('v:') ? 'vertex' : 'edge', i * 7 + 3);
    await expect.poll(async () => (await hostGame(host)).version).toBeGreaterThan(g.version);
  }
  throw new Error('setup did not finish');
}

async function discardViaUi(p: Player): Promise<void> {
  const d = p.page.getByRole('dialog');
  const btn = d.getByRole('button', { name: /^Discard \d+\/\d+$/ });
  await expect(btn).toBeVisible();
  for (let k = 0; k < 60 && !(await btn.isEnabled()); k++) {
    const more = d.getByRole('button', { name: 'more' });
    const n = await more.count();
    for (let j = 0; j < n; j++) {
      if (await more.nth(j).isEnabled()) { await more.nth(j).click(); break; }
    }
  }
  await btn.click();
  await expect(d).toHaveCount(0);
}

test('two players: lobby, setup, roll, build, trade, dev card, robber, reconnect', async ({ browser }) => {
  const host = await newPlayer(browser, 'Ada');
  const guest = await newPlayer(browser, 'Bob');

  /* ------------------------------ lobby ------------------------------ */
  let link = '';
  await test.step('host creates a room, guest joins via invite link', async () => {
    await createRoom(host);
    link = await copyInviteLink(host);
    expect(link).toMatch(/#\/room\/[A-Z0-9]{6}$/);
    await joinViaLink(guest, link);
    await expect(host.page.locator('.player-row', { hasText: 'Bob' })).toBeVisible();
    await expect(guest.page.locator('.player-row', { hasText: 'Ada' })).toBeVisible();
  });

  await test.step('guest picks a color; host sees it', async () => {
    await guest.page.getByRole('button', { name: 'Change your color' }).click();
    // pick green (#43a047)
    await guest.page.locator('.color-pop .swatch[style*="rgb(67, 160, 71)"]').click();
    await expect(host.page.locator('.player-row', { hasText: 'Bob' }).locator('.swatch').first())
      .toHaveCSS('background-color', 'rgb(67, 160, 71)');
  });

  await test.step('host changes settings; guest sees them', async () => {
    await settingRow(host.page, 'Points to win').getByRole('button', { name: 'Increase' }).click();
    await settingRow(host.page, 'Discard limit').getByRole('button', { name: 'Increase' }).click();
    await settingRow(host.page, 'Dice').getByRole('button', { name: 'Balanced' }).click();
    await settingRow(host.page, 'Friendly robber').getByRole('switch').click();
    await expect(settingRow(guest.page, 'Points to win')).toContainText('11');
    await expect(settingRow(guest.page, 'Discard limit')).toContainText('8');
    await expect(settingRow(guest.page, 'Dice').getByRole('button', { name: 'Balanced' })).toHaveClass(/active/);
    await expect(settingRow(guest.page, 'Friendly robber').getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    await expect(settingRow(guest.page, 'Map')).toContainText('Standard');
    // Turn friendly robber back off so the robber test below can rob a 2-VP player.
    await settingRow(host.page, 'Friendly robber').getByRole('switch').click();
    await expect(settingRow(guest.page, 'Friendly robber').getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  await test.step('chat works both ways', async () => {
    await guest.page.getByPlaceholder('Message…').fill('hi from bob');
    await guest.page.getByPlaceholder('Message…').press('Enter');
    await expect(host.page.locator('.lobby-chat')).toContainText('hi from bob');
  });

  await test.step('guest readies, host starts', async () => {
    // Settings changes un-ready guests, so ready up last.
    await guest.page.getByRole('button', { name: "I'm ready" }).click();
    await expect(host.page.locator('.player-row', { hasText: 'Bob' })).toContainText('Ready');
    await host.page.getByRole('button', { name: 'Start game' }).click();
    await expect(host.page.locator('.g-root')).toBeVisible();
    await expect(guest.page.locator('.g-root')).toBeVisible();
    const g = await hostGame(host);
    expect(g.phase).toBe('setup');
    await shot(host, 'game-start-host');
  });

  /* ------------------------------ setup ------------------------------ */
  const g0 = await hostGame(host);
  const id: Record<string, string> = Object.fromEntries(g0.players.map((p) => [p.name, p.id]));
  const byId: Record<string, Player> = { [id.Ada]: host, [id.Bob]: guest };

  await test.step('both players complete setup by clicking highlighted spots', async () => {
    await playSetup(host, byId);
    const g = await hostGame(host);
    expect(g.phase).toBe('preRoll');
    expect(g.pieces.filter((p) => p.type === 'settlement')).toHaveLength(4);
    expect(g.pieces.filter((p) => p.type === 'road')).toHaveLength(4);
    // Both screens show all 8 pieces.
    for (const p of [host, guest]) await expect(p.page.locator('.g-piece')).toHaveCount(8);
  });

  const first = byId[g0.turnOrder.length ? (await hostGame(host)).turnOrder[(await hostGame(host)).currentPlayerIndex] : id.Ada];
  const second = first === host ? guest : host;
  const res = async (p: Player) => (await hostGame(host)).players.find((x) => x.name === p.name)!.resources;

  /* --------------------------- first turn ---------------------------- */
  await test.step('roll (forced 8) — both see the dice', async () => {
    await hook(host, 'giveResources', id[first.name], { brick: 4, lumber: 9, wool: 3, grain: 3, ore: 3 });
    await hook(host, 'giveResources', id[second.name], { ore: 2, wool: 2 });
    expect(await hook(host, 'forceNextRoll', 8)).toBe(true);
    await expect(second.page.getByRole('button', { name: 'Roll' })).toBeDisabled();
    await first.page.getByRole('button', { name: 'Roll' }).click();
    for (const p of [first, second]) await expect(p.page.locator('.g-dice-total')).toHaveText('8');
  });

  await test.step('build a road on a highlighted edge', async () => {
    await first.page.locator('.g-abtn[title^="Road"]').click();
    await clickHighlight(first, 'edge', 0);
    await expect.poll(async () => (await hostGame(host)).pieces.filter((p) => p.type === 'road' && p.owner === id[first.name]).length).toBe(3);
    await expect(second.page.locator('.g-piece')).toHaveCount(9);
  });

  await test.step('bank trade 4:1 (or port rate)', async () => {
    const before = await res(first);
    await first.page.getByRole('button', { name: /^Trade/ }).first().click();
    const dlg = first.page.getByRole('dialog', { name: 'Trade' });
    await dlg.locator('button[title^="Lumber:"]').click();
    await dlg.locator('button[title="Ore"]').click();
    await dlg.getByRole('button', { name: 'Trade with bank' }).click();
    await expect.poll(async () => (await res(first)).ore).toBe(before.ore + 1);
    expect((await res(first)).lumber).toBeLessThan(before.lumber);
  });

  await test.step('player trade: offer → accept → confirm', async () => {
    const a0 = await res(first), b0 = await res(second);
    await first.page.getByRole('button', { name: /^Trade/ }).first().click();
    const dlg = first.page.getByRole('dialog', { name: 'Trade' });
    await dlg.getByRole('tab', { name: 'Players' }).click();
    await dlg.getByRole('button', { name: 'more Brick' }).first().click();
    await dlg.getByRole('button', { name: 'more Ore' }).last().click();
    await dlg.getByRole('button', { name: 'Send offer' }).click();
    const offers = second.page.locator('.g-offers');
    await expect(offers).toBeVisible();
    await offers.getByRole('button', { name: 'Accept' }).click();
    await first.page.locator('.g-offers').getByRole('button', { name: 'Trade' }).click();
    await expect.poll(async () => (await hostGame(host)).trades.length).toBe(0);
    const a1 = await res(first), b1 = await res(second);
    expect([a1.brick, a1.ore]).toEqual([a0.brick - 1, a0.ore + 1]);
    expect([b1.brick, b1.ore]).toEqual([b0.brick + 1, b0.ore - 1]);
  });

  await test.step('buy a development card (Year of Plenty stacked on top)', async () => {
    await hook(host, 'stackDeck', 'dev', ['yearOfPlenty']);
    await first.page.locator('.g-abtn[title^="Buy Development"]').click();
    await expect(first.page.locator('.g-self .g-card', { hasText: 'Year of Plenty' })).toBeVisible();
    // Not playable on the turn it was bought.
    await expect(first.page.locator('.g-card--playable')).toHaveCount(0);
    // The opponent sees one hidden card.
    await expect(second.page.locator('.g-opp-counts [title="Cards in hand"]')).toContainText('1');
    await first.page.getByRole('button', { name: 'End turn' }).click();
    await expect(second.page.locator('.g-turn--mine')).toBeVisible();
  });

  /* ------------------------ second player: a 7 ----------------------- */
  await test.step('7: both discard, robber moves, steal', async () => {
    await hook(host, 'giveResources', id[second.name], { grain: 9 });
    await hook(host, 'giveResources', id[first.name], { grain: 9 });
    expect(await hook(host, 'forceNextRoll', 7)).toBe(true);
    await second.page.getByRole('button', { name: 'Roll' }).click();
    await expect.poll(async () => (await hostGame(host)).prompts.filter((p) => p.kind === 'discard').length).toBe(2);
    await shot(first, 'discard');
    await discardViaUi(first);
    await discardViaUi(second);
    await expect.poll(async () => (await hostGame(host)).prompts.map((p) => p.kind).join()).toBe('location');
    // Move the robber onto a hex next to the first player's settlement so there is a victim.
    const g = await hostGame(host);
    const robberBefore = g.tokens.robber;
    await shot(second, 'robber-prompt');
    const mySettlement = g.pieces.find((p) => p.owner === id[first.name] && p.type === 'settlement')!.at;
    const targetHex = g.prompts[0].options.find((h) => hexTouchesVertex(h, mySettlement));
    if (targetHex) {
      await second.page.locator(`.g-hl-hex[data-loc="${targetHex}"]`).click({ force: true });
    } else {
      await clickHighlight(second, 'hex', 0);
    }
    await expect.poll(async () => (await hostGame(host)).tokens.robber).not.toBe(robberBefore);
    const g2 = await hostGame(host);
    if (g2.prompts[0]?.kind === 'player') {
      const before = (await res(first));
      const total = Object.values(before).reduce((a, b) => a + b, 0);
      await second.page.getByRole('dialog').getByRole('button', { name: /Ada|Bob/ }).first().click();
      await expect.poll(async () => Object.values(await res(first)).reduce((a, b) => a + b, 0)).toBe(total - 1);
    }
    await expect.poll(async () => (await hostGame(host)).prompts.length).toBe(0);
    for (const p of [first, second]) await expect(p.page.locator('.g-token')).toBeVisible();
  });

  /* ------------------------ reconnects mid-game ---------------------- */
  await test.step('guest reloads mid-game and is back in the game', async () => {
    const v = (await hostGame(host)).version;
    await guest.page.reload();
    await expect(guest.page.locator('.g-root')).toBeVisible({ timeout: 60_000 });
    await expect(guest.page.locator('.g-piece')).toHaveCount(9);
    await expect(host.page.locator('.banner')).toHaveCount(0);
    expect((await hostGame(host)).version).toBe(v);
  });

  await test.step('host reloads: room and game resume, guest reconnects', async () => {
    const v = (await hostGame(host)).version;
    await host.page.reload();
    await expect(host.page.locator('.g-root')).toBeVisible({ timeout: 30_000 });
    // Re-registering the room id on the broker can take a while after a refresh.
    await expect(host.page.locator('.banner')).toHaveCount(0, { timeout: 120_000 });
    expect((await hostGame(host)).version).toBe(v);
    // After a restart every seat starts offline; the guest must reconnect on its own.
    await expect.poll(async () => (await hostLobbyPlayers(host)).find((p) => p.name === 'Bob')?.connected, { timeout: 90_000 }).toBe(true);
    await expect(guest.page.locator('.banner')).toHaveCount(0, { timeout: 30_000 });
    // Prove the link is live again: the second player ends their turn, the first sees it.
    await second.page.getByRole('button', { name: 'End turn' }).click();
    await expect(first.page.locator('.g-turn--mine')).toBeVisible();
  });

  /* ------------------------- play a dev card ------------------------- */
  await test.step('play Year of Plenty: take 2 ore', async () => {
    expect(await hook(host, 'forceNextRoll', 6)).toBe(true);
    await first.page.getByRole('button', { name: 'Roll' }).click();
    await expect(first.page.locator('.g-dice-total')).toHaveText('6');
    const before = await res(first);
    await first.page.locator('.g-card--playable', { hasText: 'Year of Plenty' }).click();
    for (let k = 0; k < 2; k++) {
      const v = (await hostGame(host)).version;
      await first.page.getByRole('dialog').getByRole('button').filter({ hasText: 'Ore' }).click();
      await expect.poll(async () => (await hostGame(host)).version).toBeGreaterThan(v);
    }
    expect((await res(first)).ore).toBe(before.ore + 2);
    await expect(first.page.locator('.g-self')).toContainText('Played');
    await expect(second.page.locator('.g-log')).toContainText('plays Year of Plenty');
    await shot(first, 'after-dev-card');
  });

  expect(host.errors, 'host console errors').toEqual([]);
  expect(guest.errors.filter((e) => !/peerjs|WebRTC|ICE|turn\.peerjs/i.test(e)), 'guest console errors').toEqual([]);
});

/** Does hex `h:q,r` have vertex `v` as a corner? Mirrors hexCorners() in engine/board/topology.ts. */
function hexTouchesVertex(hex: string, vertex: string): boolean {
  const [q, r] = hex.slice(2).split(',').map(Number);
  const corners = [
    `v:${q},${r},N`, `v:${q + 1},${r - 1},S`, `v:${q},${r + 1},N`,
    `v:${q},${r},S`, `v:${q - 1},${r + 1},N`, `v:${q},${r - 1},S`,
  ];
  return corners.includes(vertex);
}
