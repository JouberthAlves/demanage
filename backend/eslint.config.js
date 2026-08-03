import js from '@eslint/js';
import globals from 'globals';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.eslintrc.js',
      '**/src/generated/**',
    ],
  },
  ...tseslint.config(
    {
      extends: [js.configs.recommended, ...tseslint.configs.recommended],
      files: ['**/*.{ts,tsx}'],
      languageOptions: {
        ecmaVersion: 2020,
        globals: globals.node,
        sourceType: 'module',
      },
      ignores: [
        'node_modules',
        'dist',
        'coverage',
        'src/generated',
        'src/server.ts'
      ],
      plugins: {
        'simple-import-sort': simpleImportSort,
      },
      rules: {
        'no-unused-vars': 'off',
        '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
        'simple-import-sort/imports': [
          'warn',
          {
            groups: [
              ['^node:', '^@?\\w'],
              ['^@/'],
              ['^\\.'],
            ],
          },
        ],
        'simple-import-sort/exports': 'warn',
      },
    }
  ),
];