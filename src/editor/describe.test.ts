import { describe, expect, it } from 'vitest';
import type { Effect } from '../engine/schema';
import {
  contextFromDefinition, describeCondition, describeEffect, describeEffects, describeExpr, prettify, summarizeEffects,
} from './describe';
import { mergeMods } from './merge';

const ctx = contextFromDefinition(mergeMods([{
  meta: { id: 'base', name: 'Base', version: '1' },
  resources: [
    { id: 'brick', name: 'Brick', color: '#a00', kind: 'resource', bankSupply: 19 },
    { id: 'lumber', name: 'Lumber', color: '#0a0', kind: 'resource', bankSupply: 19 },
    { id: 'ore', name: 'Ore', color: '#888', kind: 'resource', bankSupply: 19 },
  ],
  pieces: [
    { id: 'road', name: 'Road', supply: 15, placement: { on: 'edge', where: true } },
    { id: 'settlement', name: 'Settlement', supply: 5, placement: { on: 'vertex', where: true } },
    { id: 'city', name: 'City', supply: 4, placement: { on: 'vertex', where: true } },
  ],
  decks: [{ id: 'dev', name: 'Development deck', cards: [] }],
  tokens: [{ id: 'robber', name: 'Robber', on: 'hex', where: true }],
}]));

describe('describeEffect', () => {
  it('road building', () => {
    const e: Effect = { op: 'repeat', times: 2, do: [{ op: 'place', piece: 'road', free: true }] };
    expect(describeEffects([e], ctx)).toEqual(['Repeat 2 times: place a Road for free']);
  });

  it('resources and players', () => {
    expect(describeEffect({ op: 'gain', resources: { brick: 1, lumber: 2 } }, ctx)).toBe('gain 1 Brick and 2 Lumber');
    expect(describeEffect({ op: 'gain', player: { var: 'p' }, resources: { ore: 1 } }, ctx)).toBe('player “p” gains 1 Ore');
    expect(describeEffect({ op: 'steal', from: { var: 'victim' } }, ctx)).toBe('steal 1 random card from player “victim”');
    expect(describeEffect({ op: 'pay', resources: {} }, ctx)).toBe('pay nothing');
  });

  it('monopoly-like composition', () => {
    const list: Effect[] = [
      { op: 'chooseResource', as: 'res' },
      { op: 'forEachPlayer', as: 'p', filter: { not: { samePlayer: [{ var: 'p' }, 'self'] } }, do: [
        { op: 'transfer', from: { var: 'p' }, to: 'self', resource: { var: 'res' }, amount: { resourceCount: { player: { var: 'p' }, resource: { var: 'res' } } } },
      ] },
    ];
    const lines = describeEffects(list, ctx);
    expect(lines[0]).toBe('Name a resource as “res”');
    expect(lines[1]).toContain('For each player “p” where not (player “p” is you)');
    expect(lines[1]).toContain('the number of “res” resource cards player “p” holds');
  });

  it('upgrade, token, cards, VP', () => {
    expect(describeEffect({ op: 'upgrade', from: 'settlement', to: 'city' }, ctx)).toBe('upgrade a Settlement to a City');
    expect(describeEffect({ op: 'moveToken', token: 'robber' }, ctx)).toBe('move the Robber');
    expect(describeEffect({ op: 'drawCard', deck: 'dev' }, ctx)).toBe('draw 1 card from Development deck');
    expect(describeEffect({ op: 'addVP', amount: 2 }, ctx)).toBe('gain 2 victory points');
    expect(describeEffect({ op: 'addVP', amount: 1 }, ctx)).toBe('gain 1 victory point');
  });

  it('if / else', () => {
    const e: Effect = { op: 'if', cond: { cmp: [{ dice: 'total' }, '==', 7] }, then: [{ op: 'endTurn' }], else: [{ op: 'rollDice' }] };
    expect(describeEffect(e, ctx)).toBe('if the dice total is 7: end the turn; otherwise roll the dice');
  });

  it('unknown ops do not throw', () => {
    expect(describeEffect({ op: 'nope' } as unknown as Effect, ctx)).toMatch(/unknown/);
  });

  it('summarizes lists', () => {
    expect(summarizeEffects([], ctx)).toBe('Does nothing yet');
    expect(summarizeEffects([{ op: 'rollDice' }, { op: 'endTurn' }], ctx)).toBe('Roll the dice, then end the turn');
  });
});

describe('describeCondition / describeExpr', () => {
  it('conditions', () => {
    expect(describeCondition(true)).toBe('always');
    expect(describeCondition({ all: [{ isTurnOf: 'self' }, { hasRolled: true }] })).toBe('it is your turn and the dice have been rolled');
    expect(describeCondition({ canAfford: { cost: { brick: 1 } } }, ctx)).toBe('you can afford 1 Brick');
    expect(describeCondition({ cmp: [{ vp: 'self' }, '>=', 8] })).toBe('your victory point total is at least 8');
    expect(describeCondition({ adjacentTo: { at: 'at', piece: 'road', owner: 'self' } }, ctx)).toBe('“at” is next to a Road owned by you');
  });

  it('exprs', () => {
    expect(describeExpr(3)).toBe('3');
    expect(describeExpr({ add: [1, { mul: [2, { var: 'n' }] }] })).toBe('1 + (2 × “n”)');
    expect(describeExpr({ div: [{ resourceCount: {} }, 2] })).toBe('the number of resource cards you hold ÷ 2 (rounded down)');
    expect(describeExpr({ pieceCount: { owner: 'self', piece: 'city' } }, ctx)).toBe('the number of Cities owned by you on the board');
    expect(describeExpr({ playerCount: true })).toBe('the number of players');
  });

  it('prettify', () => {
    expect(prettify('yearOfPlenty')).toBe('Year of plenty');
    expect(prettify('road_building')).toBe('Road building');
  });
});
