import { describe, expect, it } from 'vitest';
import { remapRoad } from './road';
import type { LngLat } from './geo';

const sq: LngLat[] = [[0, 0], [0, 1], [1, 1], [1, 0]];
describe('remapRoad keeps road frontage through edits', () => {
  it('same corner count (drag) keeps indices', () => {
    expect(remapRoad(sq, [[0, 0], [0, 1.2], [1, 1], [1, 0]], [0])).toEqual([0]);
  });
  it('inserting a corner on the road edge marks both halves', () => {
    expect(remapRoad(sq, [[0, 0], [0, 0.5], [0, 1], [1, 1], [1, 0]], [0])).toEqual([0, 1]);
  });
  it('inserting a corner elsewhere shifts the index correctly', () => {
    expect(remapRoad(sq, [[0, 0], [0, 1], [1, 1], [1, 0], [0.5, -0.1]], [2])).toEqual([2]);
  });
  it('deleting a corner merges edges', () => {
    expect(remapRoad(sq, [[0, 0], [1, 1], [1, 0]], [1])).toEqual([0]);
  });
});
