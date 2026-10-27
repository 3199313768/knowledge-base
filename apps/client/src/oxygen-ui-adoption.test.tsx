import { describe, expect, it } from 'vitest';
// @ts-expect-error The client does not ship Node typings; Vitest executes this source check in Node.
import { readFileSync } from 'node:fs';

const appStyles = readFileSync('src/App.css', 'utf8');

const entryModules = import.meta.glob('./main.tsx', {
  eager: true,
  import: 'default',
  query: '?raw'
}) as Record<string, string>;

describe('Oxygen UI bootstrap adoption', () => {
  it('imports the Oxygen stylesheet exactly once from the React entry point', () => {
    const entrySource = Object.values(entryModules).find(
      (source): source is string => typeof source === 'string',
    );

    expect(entrySource).toEqual(expect.any(String));
    expect(entrySource?.match(/@oxygen-design\/ui\/styles\.css/g)).toHaveLength(1);
  });

  it('positions the password toggle through its Oxygen-compatible class', () => {
    expect(appStyles).toMatch(/\.password-input__toggle\s*\{/);
    expect(appStyles).toMatch(/\.auth-form\s*>\s*\.oxygen-button\s*\{/);
  });
});
