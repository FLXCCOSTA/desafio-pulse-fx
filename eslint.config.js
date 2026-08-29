// Configuração de lint do monorepo (flat config, ESLint 9).
//
// A escolha central aqui é usar as regras que exigem informação de tipo
// (`recommendedTypeChecked`). Elas custam tempo de execução, mas pegam a classe
// de erro que mais dói neste projeto: promise não aguardada dentro de uma rota,
// `any` vazando de uma resposta externa, comparação sempre verdadeira.

import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      'apps/web/public/sw.js', // service worker roda em escopo próprio
      'eslint.config.js',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Promise ignorada numa rota HTTP some sem deixar rastro: erro que só
      // aparece como requisição pendurada em produção.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // Import de tipo explícito, coerente com verbatimModuleSyntax.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      // Underscore sinaliza intenção deliberada de ignorar o argumento.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      'no-console': ['warn', { allow: ['error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  // ─── Backend ────────────────────────────────────────────────────
  {
    files: ['apps/api/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  // ─── Frontend ───────────────────────────────────────────────────
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // ─── Testes ─────────────────────────────────────────────────────
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      // Dublês precisam de asserção de tipo para satisfazer interfaces amplas
      // sem reimplementá-las inteiras.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',

      // Um dublê de função assíncrona devolve valor pronto e não tem o que
      // aguardar; exigir await ali só produziria ruído sem ganho.
      '@typescript-eslint/require-await': 'off',

      // response.json() devolve any por contrato do Fastify e do fetch. Nos
      // testes, navegar nesse objeto é justamente o que se quer verificar.
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',

      'no-console': 'off',
    },
  },
);
