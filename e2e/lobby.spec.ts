/** Lobby edge cases: second tab, host leaves and resumes, late joiner, kick. */
import { expect, test } from '@playwright/test';
import { copyInviteLink, createRoom, hostLobbyPlayers, joinViaLink, newPlayer, shot } from './helpers';

test('same player in two tabs does not ping-pong', async ({ browser }) => {
  const host = await newPlayer(browser, 'Ada');
  const guest = await newPlayer(browser, 'Bob');
  await createRoom(host);
  const link = await copyInviteLink(host);
  await joinViaLink(guest, link);
  const tab2 = await guest.ctx.newPage();
  await tab2.goto(link);
  await expect(tab2.getByRole('heading', { name: /Players/ })).toBeVisible({ timeout: 60_000 });
  // Give both tabs time to fight over the seat if they were going to.
  await tab2.waitForTimeout(8000);
  await shot({ ...guest, page: tab2 }, 'lobby-tab2');
  await shot(guest, 'lobby-tab1');
  // The old tab explains why it stopped and offers to take the seat back.
  await expect(guest.page.locator('.banner')).toContainText('another tab');
  await expect(guest.page.locator('.banner').getByRole('button', { name: 'Retry' })).toBeVisible();
  // Exactly one Bob, connected; the newest tab owns the seat and stays connected.
  const players = await hostLobbyPlayers(host);
  expect(players.filter((p) => p.name === 'Bob')).toHaveLength(1);
  await expect(tab2.locator('.banner')).toHaveCount(0);
  await expect(tab2.getByRole('button', { name: "I'm ready" })).toBeEnabled();
  await tab2.getByRole('button', { name: "I'm ready" }).click();
  await expect(host.page.locator('.player-row', { hasText: 'Bob' })).toContainText('Ready');
});

test('host leaves, resumes from the home page; late joiner and kick', async ({ browser }) => {
  const host = await newPlayer(browser, 'Ada');
  const guest = await newPlayer(browser, 'Bob');
  const code = await createRoom(host);
  const link = await copyInviteLink(host);
  await joinViaLink(guest, link);

  await test.step('host leaves (keeping the room) and resumes it', async () => {
    host.page.removeAllListeners('dialog');
    host.page.once('dialog', (d) => void d.dismiss()); // "Close this room for everyone?" -> Cancel = just leave
    await host.page.getByRole('button', { name: 'Leave' }).click();
    await expect(host.page.getByRole('button', { name: /Resume room/ })).toContainText(code);
    await host.page.getByRole('button', { name: /Resume room/ }).click();
    await expect(host.page.locator('.player-row', { hasText: 'Bob' })).toBeVisible();
    await expect.poll(async () => (await hostLobbyPlayers(host)).find((p) => p.name === 'Bob')?.connected).toBe(true);
    host.page.on('dialog', (d) => void d.accept());
  });

  await test.step('host kicks a third player; they see why', async () => {
    const carol = await newPlayer(browser, 'Carol');
    await joinViaLink(carol, link);
    await expect(host.page.locator('.player-row', { hasText: 'Carol' })).toBeVisible();
    await host.page.locator('.player-row', { hasText: 'Carol' }).locator('button[title^="Kick"]').click();
    await expect(carol.page.getByRole('heading', { name: 'Removed from room' })).toBeVisible();
    await expect(host.page.locator('.player-row', { hasText: 'Carol' })).toHaveCount(0);
    await carol.ctx.close();
  });

  await test.step('a player arriving after the start is told the game is in progress', async () => {
    await guest.page.getByRole('button', { name: "I'm ready" }).click();
    await host.page.getByRole('button', { name: 'Start game' }).click();
    await expect(guest.page.locator('.g-root')).toBeVisible();
    const dave = await newPlayer(browser, 'Dave');
    await dave.page.goto(link);
    await dave.page.getByLabel('Your name').fill('Dave');
    await dave.page.getByRole('button', { name: 'Join' }).click();
    await expect(dave.page.getByRole('heading', { name: "Couldn't join room" })).toBeVisible({ timeout: 60_000 });
    await expect(dave.page.locator('main')).toContainText('Game already in progress');
    await dave.ctx.close();
  });
});
