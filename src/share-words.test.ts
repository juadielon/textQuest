import { expect, it } from 'vitest';
import { versionTwoFirstWords, versionTwoSecondWords } from './share-words';

it('pins the complete version 2 word lists', async () => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify([versionTwoFirstWords, versionTwoSecondWords])),
  );
  expect([...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''))
    .toBe('591433161cd29222244bed8f5e6bd80567a76959ad078e86277604c272de844a');
});
