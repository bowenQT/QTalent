import { defineConfig } from 'vitest/config';
import unit from './vitest.config';
// One instrumentation run merges unit and genuine PostgreSQL integration coverage.
export default defineConfig({
  ...unit,
  test: { ...unit.test, exclude: [], fileParallelism: false },
});
