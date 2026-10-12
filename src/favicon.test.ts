// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import indexHtml from '../index.html?raw';
import faviconSvg from '../public/favicon.svg?raw';

it('links the SVG favicon from the page head', () => {
  const page = new DOMParser().parseFromString(indexHtml, 'text/html');
  const icon = page.head.querySelector('link[rel="icon"]');

  expect(icon?.getAttribute('type')).toBe('image/svg+xml');
  expect(icon?.getAttribute('href')).toBe('/favicon.svg');
});

it('ships a self-contained square SVG favicon', () => {
  const svg = new DOMParser().parseFromString(faviconSvg, 'image/svg+xml').documentElement;

  expect(svg.tagName.toLowerCase()).toBe('svg');
  expect(svg.getAttribute('viewBox')).toBe('0 0 32 32');
  // Tab icons should not depend on scripts, fonts or other files.
  expect(faviconSvg).not.toMatch(/<script|<text|href=/i);
});
