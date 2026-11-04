import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// A hex colour outside tokens.css breaks theming: colours come from Tailwind classes that map to the CSS variables.
const HEX = String.raw`/#[0-9a-fA-F]{3,8}\b/`;
const message = 'No hex colours outside styles/tokens.css. Use a token class such as bg-surface or text-fg-2.';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: `Literal[value=${HEX}]`, message },
        { selector: `TemplateElement[value.raw=${HEX}]`, message },
        { selector: `JSXText[value=${HEX}]`, message },
      ],
    },
  },
);
