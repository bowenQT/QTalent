export const adminTabs = ['acct', 'hr', 'intg', 'conn', 'audit'] as const;
export type AdminTab = (typeof adminTabs)[number];

/** `?tab=` as the prototype names it; 接入状态 opens by default in this slice. */
export const adminTabOf = (value: unknown): AdminTab =>
  adminTabs.find((item) => item === value) ?? 'conn';
