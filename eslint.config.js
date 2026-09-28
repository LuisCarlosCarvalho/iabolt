import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'test-results', 'playwright-report', 'playwright-report-server'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-ignore': true, 'ts-expect-error': true, 'ts-nocheck': true }],
    },
  },
  {
    // Scripts de ferramentas correm em Node.
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },
  {
    // Runtime servido às páginas (canvas, prévia, exportação): JavaScript de browser, sem build.
    files: ['public/assets/runtime/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        window: 'readonly', document: 'readonly', CSS: 'readonly', ResizeObserver: 'readonly', MutationObserver: 'readonly',
        requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly', setTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
      },
    },
    // ES5 sem classes nem arrow functions: `var self = this` é o idioma para os callbacks.
    rules: { '@typescript-eslint/no-this-alias': 'off' },
  },
);
