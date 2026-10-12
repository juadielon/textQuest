import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  {
    files: ['src/**/*.ts'],
    extends: [tseslint.configs.recommended],
  },
]);
