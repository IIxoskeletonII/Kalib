import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist', 'dev-dist', 'node_modules', '.cache', 'public'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Persistence must go through src/db/repo — never call Dexie from UI code.
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'dexie', message: 'Import from @/db/repo/* instead.' }] },
      ],
    },
  },
  {
    files: ['src/db/**/*.ts', 'src/test/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
);
