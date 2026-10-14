import { describe, expect, it } from 'vitest';
import { parseHash } from './router';

describe('parseHash', () => {
  it('parses routes', () => {
    expect(parseHash('')).toEqual({ name: 'home' });
    expect(parseHash('#/')).toEqual({ name: 'home' });
    expect(parseHash('#/room/abc234')).toEqual({ name: 'room', code: 'ABC234' });
    expect(parseHash('#/room/ABC234/')).toEqual({ name: 'room', code: 'ABC234' });
    expect(parseHash('#/editor')).toEqual({ name: 'editor' });
    expect(parseHash('#/what')).toEqual({ name: 'notFound', path: '/what' });
  });
});
