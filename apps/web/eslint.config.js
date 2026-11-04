import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: globals.browser } },
  {
    // A hex colour outside tokens.css breaks theming. Colours come from Tailwind classes that map to variables.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: "Literal[value=/#[0-9a-fA-F]{3,8}\b/]", message: 'No hex colours outside styles/tokens.css.' },
      ],
    },
  },
);
