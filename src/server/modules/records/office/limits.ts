/** Existing extraction ceilings, shared without importing the parsing library in the caller. */
export const officeLimits = {
  maxInputBytes: 8 * 1024 * 1024,
  maxUncompressedBytes: 32 * 1024 * 1024,
  maxZipEntries: 1024,
  maxTableCells: 20_000,
  maxXmlElements: 200_000,
  maxRepeatedContent: 2_000_000,
  maxRawContentLength: 96 * 1024 * 1024,
  maxTextChars: 2_000_000,
} as const;
export const officeWorkerLimits = {
  maxDurationMs: 60_000,
  maxOldGenerationSizeMb: 256,
  maxOutputBytes: 16 * 1024 * 1024,
  maxDiagnosticBytes: 64 * 1024,
} as const;
