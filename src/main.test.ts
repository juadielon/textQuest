// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';

afterEach(() => {
  document.body.replaceChildren();
});

it('mounts the placeholder when the browser entry point loads', async () => {
  const app = document.createElement('main');
  app.id = 'app';
  document.body.append(app);

  await import('./main');

  expect(app.querySelector('h1')?.textContent).toBe('textQuest');
  expect(app.querySelector('.status')?.textContent).toContain('not playable yet');
});
