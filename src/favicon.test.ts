// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import indexHtml from '../index.html?raw';
import faviconSvg from './favicon.svg?raw';

describe('favicon', () => {
  it('is linked from the HTML entry point as an SVG icon', () => {
    const page = new DOMParser().parseFromString(indexHtml, 'text/html');
    const icon = page.querySelector('link[rel="icon"]');

    expect(icon?.getAttribute('href')).toBe('/src/favicon.svg');
    expect(icon?.getAttribute('type')).toBe('image/svg+xml');
  });

  it('is a square SVG with an accessible title', () => {
    const icon = new DOMParser().parseFromString(faviconSvg, 'image/svg+xml');
    const root = icon.documentElement;

    expect(root.nodeName).toBe('svg');
    expect(root.getAttribute('viewBox')).toBe('0 0 64 64');
    expect(root.querySelector('title')?.textContent).toBe('textQuest');
  });
});
