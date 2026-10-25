// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { componentSamples } from './component-samples';

describe('frozen design-system sample selectors', () => {
  const html = readFileSync(
    '.reference-cache/prototype/y/design-system.html',
    'utf8',
  );
  it.each(componentSamples)(
    'selects exactly the intended $name sample',
    (sample) => {
      document.documentElement.innerHTML = html;
      const matches = document.querySelectorAll(sample.reference);
      expect(matches).toHaveLength(1);
      expect(matches[0].textContent?.trim()).toBe(sample.text);
      if (sample.name === 'button')
        expect(matches[0].getAttribute('role')).not.toBe('menuitem');
      if (sample.name === 'input-field')
        expect(matches[0].querySelector('input')?.value).toBe(
          '海外加速搜索体验',
        );
      if (sample.name === 'badge')
        expect(matches[0].querySelector('use')?.getAttribute('href')).toBe(
          '#i-check',
        );
    },
  );
});
