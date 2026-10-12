/** Text the placeholder page shows as its heading. */
export const gameTitle = 'textQuest';

/** Tells visitors the game isn't playable yet. */
export const statusMessage =
  'This is an early placeholder. The game is not playable yet.';

/**
 * Replaces the contents of `target` with the placeholder heading and status.
 *
 * @param target - The element to render into, usually `#app`.
 */
export function renderPlaceholder(target: HTMLElement): void {
  const heading = document.createElement('h1');
  heading.textContent = gameTitle;

  const status = document.createElement('p');
  status.className = 'status';
  status.textContent = statusMessage;

  target.replaceChildren(heading, status);
}
