// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    files: ['src/**/*.ts'],
    extends: [...tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  // Response conformance: a handler must name the contract response type it returns —
  // `ok<ManagerShiftResponse>(await service.x())` — so the compiler checks the service's
  // return value against contracts/openapi.json. A bare `ok(data)` (data: unknown) silently
  // bypasses that. `ok('')` (CORS preflight / empty-body deletes) has no shape to check.
  {
    files: ['src/functions/**/handler.ts', 'src/functions/shared/handler-factories.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.name=/^(ok|created)$/]:not([typeArguments]):not([arguments.0.type='Literal'])",
          message:
            'Name the contract response type: ok<XResponse>(data). A bare ok(data) skips the check against contracts/openapi.json.',
        },
      ],
    },
  },
  {
    ignores: ['dist/', '.aws-sam/'],
  },
);
