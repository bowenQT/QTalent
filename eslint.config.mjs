import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    'prototype/**',
    'review-site/**',
    '.next/**',
    'coverage/**',
    'src/server/db/migrations/**',
  ]),
]);
