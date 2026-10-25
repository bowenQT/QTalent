/**
 * Membership test for closed enumerations at runtime. `Object.hasOwn` alone turns its key into
 * a string, so `['failed']` or `new String('failed')` would pass while failing every strict
 * comparison later; only real strings that are own keys of the table are accepted.
 */
export function isEnumKey(table: object, value: unknown): value is string {
  return typeof value === 'string' && Object.hasOwn(table, value);
}
