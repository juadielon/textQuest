export const gameTitle = 'textQuest';

export const statusMessage =
  'This is an early placeholder. The game is not playable yet.';

export function renderPlaceholder(target: HTMLElement): void {
  const heading = document.createElement('h1');
  heading.textContent = gameTitle;

  const status = document.createElement('p');
  status.className = 'status';
  status.textContent = statusMessage;

  target.replaceChildren(heading, status);
}
