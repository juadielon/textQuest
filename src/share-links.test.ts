import { expect, it } from 'vitest';
import { adventureLengths, createAdventureSettings, parseShareWord } from './adventure-settings';
import { generateAdventureWorld } from './generate-world';
import { createAdventureLink } from './share-links';
import packageJson from '../package.json';

it('links recreate exact worlds for every genre and length', () => {
  for (const length of adventureLengths) {
    const genres = new Set<string>();
    for (let seed = 0; seed < 100; seed++) {
      const settings = createAdventureSettings(seed, length);
      if (genres.has(settings.genre)) continue;
      genres.add(settings.genre);
      const link = new URL(createAdventureLink(settings, 'https://example.com/textQuest/'));
      const reopened = parseShareWord(link.searchParams.get('adventure')!);
      expect(reopened).toEqual(settings);
      expect(generateAdventureWorld(reopened)).toEqual(generateAdventureWorld(settings));
    }
    expect(genres.size).toBe(3);
  }
});

it.each(['/', '/textQuest/', '/games/textQuest/index.html'])(
  'keeps the hosted app path %s and discards unrelated data', (path) => {
    const settings = createAdventureSettings(0, 'short');
    const link = new URL(createAdventureLink(settings,
      `https://example.com${path}?save=private&commands=go&adventure=silverlantern#progress`));
    expect(link.origin).toBe('https://example.com');
    expect(link.pathname).toBe(path);
    expect([...link.searchParams]).toEqual([['adventure', 'sunlitsaucer']]);
    expect(link.hash).toBe('');
  },
);

it('does not put URL credentials in a shared link', () => {
  const link = new URL(createAdventureLink(createAdventureSettings(0, 'short'),
    'https://player:private@example.com/textQuest/'));
  expect(link.username).toBe('');
  expect(link.password).toBe('');
});


it('builds relative asset URLs so a shared link can load under a static hosting sub-path', () => {
  expect(packageJson.scripts.build).toContain('vite build --base=./');
});
