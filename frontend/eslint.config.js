// @ts-check
import tseslint from 'typescript-eslint';
import angular from 'angular-eslint';

export default tseslint.config(
  // Generated from contracts/openapi.json by `npm run contracts:types`.
  // Never hand-edited, so linting it would only produce noise on regeneration.
  { ignores: ['src/app/core/generated/**'] },
  {
    files: ['**/*.ts'],
    extends: [...tseslint.configs.recommended, ...angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': ['error', { type: 'attribute', prefix: 'app', style: 'camelCase' }],
      '@angular-eslint/component-selector': ['error', { type: 'element', prefix: 'app', style: 'kebab-case' }],
    },
  },
  // Every API call goes through core/api/api-client.ts so requests and responses are typed
  // from contracts/openapi.json. Injecting HttpClient directly bypasses that. Interceptors,
  // provideHttpClient and HttpErrorResponse are unaffected — only the HttpClient class is banned.
  {
    files: ['**/*.ts'],
    ignores: ['src/app/core/api/api-client.ts', '**/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@angular/common/http',
              importNames: ['HttpClient'],
              message: 'Use ApiClient (core/api/api-client) so calls are typed from the contract.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.html'],
    extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
    rules: {},
  },
);
