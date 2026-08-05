import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescriptConfig from 'eslint-config-next/typescript';

/**
 * eslint-config-next 16 exports flat configs directly, so no FlatCompat /
 * @eslint/eslintrc shim is needed.
 *
 * Note: ESLint is pinned to 9.x in package.json. The eslint-plugin-react bundled
 * with eslint-config-next 16 still uses the pre-10 rule context API and crashes
 * on ESLint 10 — revisit when that plugin ships an ESLint 10 build.
 *
 * @next/next/no-img-element stays enabled: the two places that use a plain <img>
 * disable it inline with a reason. Provider images arrive as data URIs or remote
 * URLs whose hosts are unknown until Phase 2, which is what next/image needs
 * configured up front.
 */
const config = [
  ...coreWebVitals,
  ...typescriptConfig,
  {
    rules: {
      // Provider methods scaffolded for later phases keep their full typed
      // signature while ignoring the argument — `_input` is the marker for that.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'],
  },
];

export default config;
