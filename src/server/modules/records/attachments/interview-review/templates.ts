export type InterviewTemplate = {
  name: string;
  dimensions: readonly string[];
  rating: { label: string; options: readonly string[] };
  level: { label: string; options: readonly string[] };
};

/** These are BOW-896 synthetic fixtures, not certified Beisen export fingerprints. */
export const INTERVIEW_TEMPLATES: readonly InterviewTemplate[] = [
  '校招专业面试通用评价表',
  '七牛面试评价表-HR',
  '七牛面试评价表-专业面试官',
].map((name) => ({
  name,
  dimensions: ['专业能力', '潜力', '沟通协作', '管理能力'],
  rating: { label: '面试评级', options: ['S', 'A', 'B', 'C', 'D'] },
  level: { label: '建议职级', options: ['N1', 'N2', 'N3', 'N4', 'N5'] },
}));
