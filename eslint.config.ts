import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import stylisticJs from '@stylistic/eslint-plugin-js';
import eslintConfigPrettier from 'eslint-config-prettier';

export default [
  eslintConfigPrettier,
  {
    files: ["src/**/*.{js,ts}"],
    ignores: ["**/*.config.{js,ts}", "*.reference.ts"
    ],
    plugins: {
      '@stylistic/js': stylisticJs,
    },
    rules: {

      // // disallow async functions for Playwright's test.describe
      // 'custom/disallow-async-in-describe': 'error',

      // // enforce consistent spacing in if/else blocks
      // 'custom/if-else-spacing-consistency': 'error',
      
      // // enforce a blank line after test.describe opening brackets
      // 'custom/blank-line-after-describe': 'error',

      // // enforce a blank line before test.describe blocks
      // 'custom/blank-line-before-describe': 'error',

      // // enforce a blank line before test blocks
      // "custom/blank-line-before-test": "error",

      // // enforce a blank line before comments
      // "custom/blank-line-before-comment": "error",

      // all interfaces should be named starting with a capital I (ie. IUser, IAgency)
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'interface',
          format: ['PascalCase'],
          custom: {
            regex: '^I[A-Z]',
            match: true,
          },
        },
      ],

      // turn off default rule - allow arrays/objects to be initialized empty ([], {})
      '@typescript-eslint/no-empty-interface': 0,

      // enforce proper spacing in comments
      "spaced-comment": ["error", "always", {
        "line": {
          "markers": ["/"],
        },
        "block": {
          "markers": ["!"],
          "exceptions": ["*"],
          "balanced": true
        }
      }],

      // do not require variables to be typed
      "@typescript-eslint/typedef": 0,
      "@typescript-eslint/no-explicit-any": 0,

      // enforce trailing commas in object an object and array literals, function parameters, 
      // and other syntactic structures -- when they are each on their own line
      "comma-dangle": ["error", "always-multiline"],

      // enforce readability by limiting lines to 100 characters
      "max-len": ["error", { "code": 100 }],

      // enforce semicolons at the end of statements
      semi: "error",

      // enforce only one blank line in a row
      "no-multiple-empty-lines": ["error", { "max": 1 }],

      // bans the use of playwright's page.goto and page.waitForURL functions,
      // in favor of our own implementation of each page object's gotoAndCheckUrl function
      "no-restricted-properties": [2, {
        "property": "goto",
        "message": "Please use gotoAndCheckUrl instead of page.goto",
      }, {
        "property": "waitForURL",
        "message": "Please use gotoAndCheckUrl instead of page.waitForURL",
      }
      ],
    }
  },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
];
