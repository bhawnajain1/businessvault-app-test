import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import boundaries from 'eslint-plugin-boundaries';
import reactHooks from 'eslint-plugin-react-hooks';

const commonLanguageOptions = {
  parser: tsParser,
  ecmaVersion: 2022,
  sourceType: 'module',
  parserOptions: {
    ecmaFeatures: { jsx: true },
  },
};

const boundariesSettings = {
  'boundaries/include': ['src/**/*'],
  'boundaries/elements': [
    { type: 'domain', pattern: 'src/domain/**' },
    { type: 'journal', pattern: 'src/journal/**' },
    { type: 'drive', pattern: 'src/drive/**' },
    { type: 'sync', pattern: 'src/sync/**' },
    { type: 'ui', pattern: 'src/ui/**' },
    { type: 'storage', pattern: 'src/storage/**' },
    { type: 'db', pattern: 'src/db/**' },
    { type: 'events', pattern: 'src/events/**' },
    { type: 'csv', pattern: 'src/csv/**' },
    { type: 'excel', pattern: 'src/excel/**' },
    { type: 'export', pattern: 'src/export/**' },
    { type: 'accounting', pattern: 'src/accounting/**' },
    { type: 'restore', pattern: 'src/restore/**' },
    { type: 'boot', pattern: 'src/boot/**' },
    { type: 'lib', pattern: 'src/lib/**' },
    { type: 'test-helpers', pattern: 'src/test/**' },
    { type: 'app', pattern: 'src/*.{ts,tsx}', partialMatch: false },
  ],
};

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'public/**',
      '*.config.js',
      '*.config.cjs',
      '*.config.ts',
      'tailwind.config.obfuscated.js',
    ],
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    languageOptions: commonLanguageOptions,
    plugins: {
      '@typescript-eslint': tsPlugin,
      boundaries,
      'react-hooks': reactHooks,
    },
    settings: boundariesSettings,
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'allow',
          policies: [
            {
              from: [{ element: { type: 'domain' } }],
              disallow: [
                { to: { element: { types: { anyOf: ['drive', 'sync', 'ui'] } } } },
              ],
              message: 'src/domain must not import from {{dependency.type}}. Route side-effects through a provider interface.',
            },
            {
              from: [{ element: { type: 'journal' } }],
              disallow: [
                { to: { element: { types: { anyOf: ['drive', 'domain'] } } } },
              ],
              message: 'src/journal must not import from {{dependency.type}}. Journal is a pure hash-chain layer.',
            },
            {
              from: [{ element: { type: 'drive' } }],
              disallow: [
                { to: { element: { types: { anyOf: ['domain', 'ui'] } } } },
              ],
              message: 'src/drive must not import from {{dependency.type}}. Drive layer talks storage protocol only.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['src/ui/**', 'src/drive/**', 'src/domain/**'],
    languageOptions: commonLanguageOptions,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/drive/oauth', '**/drive/google/oauth', '@/drive/oauth', '@/drive/google/oauth'],
              message: 'Do not import OAuth internals directly. Go through the storage provider (src/drive/provider.ts).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/domain/**/*.ts', 'src/domain/**/*.tsx'],
    languageOptions: commonLanguageOptions,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/drive/oauth', '**/drive/google/oauth', '@/drive/oauth', '@/drive/google/oauth'],
              message: 'Domain must not import OAuth internals directly.',
            },
            {
              group: [
                '**/storage/GoogleDriveStorageProvider',
                '@/storage/GoogleDriveStorageProvider',
              ],
              message: 'Domain must not import GoogleDriveStorageProvider directly. Depend on the CustomerStorageProvider interface.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/ui/**/*.ts', 'src/ui/**/*.tsx'],
    languageOptions: commonLanguageOptions,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/drive/oauth', '**/drive/google/oauth', '@/drive/oauth', '@/drive/google/oauth'],
              message: 'UI must not import OAuth internals directly. Go through the storage provider (src/drive/provider.ts).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['tests/**/*.ts', 'tests/**/*.tsx', 'src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/*.spec.ts', 'src/**/*.spec.tsx'],
    languageOptions: commonLanguageOptions,
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {},
  },
];
