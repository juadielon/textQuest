import { encodeShareWord, type AdventureSettings } from './adventure-settings';

/**
 * Builds a link to the exact starting adventure at the current app path.
 * Only the versioned share word is included; query values and fragments are
 * discarded so player progress and unrelated data cannot enter the link.
 * Invalid settings throw the same RangeError as {@link encodeShareWord}.
 */
export function createAdventureLink(settings: AdventureSettings, pageUrl: string): string {
  const url = new URL(pageUrl);
  url.search = '';
  url.hash = '';
  url.username = '';
  url.password = '';
  url.searchParams.set('adventure', encodeShareWord(settings));
  return url.href;
}
