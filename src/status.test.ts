// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { gameTitle, renderPlaceholder, statusMessage } from './status';

describe('renderPlaceholder', () => {
  it('shows the title and says the game is not playable yet', () => {
    const target = document.createElement('main');

    renderPlaceholder(target);

    expect(target.querySelector('h1')?.textContent).toBe(gameTitle);
    expect(target.querySelector('.status')?.textContent).toBe(statusMessage);
    expect(statusMessage).toMatch(/not playable yet/);
  });
});
