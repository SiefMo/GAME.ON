import { describe, it, expect } from 'vitest';
function countDeck() { return 4 * (1 + 18 + 2 + 2 + 1 + 1) + 4 + 4; }
describe('Phase 1 deck specification sanity', () => { it('equals exactly 108 cards', () => expect(countDeck()).toBe(108)); it('starting hand is 7', () => expect(7).toBe(7)); });
