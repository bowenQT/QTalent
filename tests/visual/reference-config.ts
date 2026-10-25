import reference from '../../prototype-reference.json' with { type: 'json' };
export const referenceConfig = {
  commit: reference.commit,
  desktop: { width: 1366, height: 900 },
  mobile: { width: 375, height: 812 },
  pixelThreshold: 0.1,
  maxDiffPixelRatio: 0.001,
  masks: ['.nt-top .n-menuwrap', '[data-nav-count]', '.nt-recent'],
} as const;
