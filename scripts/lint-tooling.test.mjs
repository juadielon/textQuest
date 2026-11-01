import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { after, afterEach, test } from 'node:test';
import { ESLint } from 'eslint';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import { clearCaches } from '@typescript-eslint/typescript-estree';

const root = mkdtempSync(resolve('node_modules', '.lint-tooling-'));
const files = [
  'src/main.ts', 'src/nested/deep.ts', 'src/.hidden.ts', 'src/main.test.ts',
  'src/generated/drop.ts', 'src/generated/keep.ts', 'src/vendor/drop.ts',
  'tooling/check.ts', 'tooling/.hidden.ts', 'tooling/nested/check.ts',
  'tooling/excluded.ts',
];
for (const file of files) {
  const filename = join(root, file);
  mkdirSync(dirname(filename), { recursive: true });
  writeFileSync(filename, 'const unused: number = 1;\n');
}
writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({
  compilerOptions: { strict: true },
  include: ['src'],
}));

afterEach(() => clearCaches());
after(() => rmSync(root, { recursive: true, force: true }));

test('every locked minimatch and actual lint consumer uses the checked patch', () => {
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const copies = Object.entries(lock.packages).filter(([name]) =>
    /(^|\/)node_modules\/minimatch$/.test(name));
  assert.ok(copies.length > 0);
  for (const [name, entry] of copies) {
    assert.equal(entry.version, '11.0.3', name);
  }
  const require = createRequire(import.meta.url);
  for (const consumer of ['eslint', '@eslint/config-array', '@typescript-eslint/typescript-estree']) {
    const consumerRequire = createRequire(require.resolve(consumer));
    const installed = JSON.parse(readFileSync(consumerRequire.resolve('minimatch/package.json'), 'utf8'));
    assert.equal(installed.version, '11.0.3', consumer);
  }
});

test('ESLint walks nested and dot paths, applies ignores and restores a negated ignore', async () => {
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: defineConfig([
      { ignores: ['src/vendor/', 'src/generated/*', '!src/generated/keep.ts'] },
      { files: ['src/**/*.ts'], extends: tseslint.configs.recommended },
    ]),
  });
  const results = await eslint.lintFiles(['src/**/*.ts']);
  assert.deepEqual(results.map(result => relative(root, result.filePath)).sort(), [
    'src/.hidden.ts', 'src/generated/keep.ts', 'src/main.test.ts',
    'src/main.ts', 'src/nested/deep.ts',
  ]);
  for (const result of results) {
    assert.deepEqual(result.messages.map(message => message.ruleId), ['@typescript-eslint/no-unused-vars']);
  }
  for (const [file, ignored] of [
    ['src/main.ts', false], ['src/generated/drop.ts', true],
    ['src/generated/keep.ts', false], ['src/vendor/drop.ts', true],
  ]) {
    assert.equal(await eslint.isPathIgnored(join(root, file)), ignored, file);
  }
});

test('ESLint honours a negated files pattern with braces and extglobs', async () => {
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [{
      files: [['src/**/!(*.test).{ts,tsx}', '!src/generated/**', '!src/vendor/**']],
      languageOptions: { parser: tseslint.parser },
      rules: { 'no-unused-vars': 'error' },
    }],
  });
  const results = await eslint.lintFiles(['src/**/*.ts']);
  assert.deepEqual(results.map(result => relative(root, result.filePath)).sort(), [
    'src/.hidden.ts', 'src/main.ts', 'src/nested/deep.ts',
  ]);
  assert.ok(results.every(result => result.messages.some(message => message.ruleId === 'no-unused-vars')));
});

for (const [file, patterns, expected] of [
  ['tooling/check.ts', ['tooling/*.ts'], true],
  ['tooling/.hidden.ts', ['tooling/*.ts'], true],
  ['tooling/nested/check.ts', ['tooling/*.ts'], /does not match/],
  ['tooling/nested/check.ts', ['tooling/*/*.ts'], true],
  ['tooling/excluded.ts', ['!tooling/excluded.ts'], /does not match/],
  ['src/main.ts', [], true],
  ['src/main.ts', ['src/*.ts'], /also was found in the project service/],
  ['tooling/check.ts', ['tooling/**/*.ts'], /disallowed '\*\*'/],
]) {
  test(`parser service checks ${file} against ${JSON.stringify(patterns)}`, () => {
    const parse = () => tseslint.parser.parseForESLint('const value: number = 1;', {
      filePath: join(root, file),
      tsconfigRootDir: root,
      projectService: { allowDefaultProject: patterns, defaultProject: 'tsconfig.json' },
      disallowAutomaticSingleRunInference: true,
    });
    if (expected === true) {
      assert.ok(parse().services.program);
    } else {
      assert.throws(parse, expected);
    }
  });
}
