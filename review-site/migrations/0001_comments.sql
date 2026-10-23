-- 评审评论：一条讨论（parent_id 为空）加若干回复。
-- 锚点二选一：kind = 'text' 用划线原文 + 前后文定位；kind = 'element' 用元素路径 + 元素文字定位。
-- context 记录评论时的现场（视角、手机/桌面、页面内状态），JSON 文本。
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES comments(id),
  page TEXT NOT NULL,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT CHECK (kind IN ('text', 'element')),
  quote TEXT,
  prefix TEXT,
  suffix TEXT,
  selector TEXT,
  label TEXT,
  context TEXT,
  resolved INTEGER NOT NULL DEFAULT 0,
  resolved_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_page ON comments(page, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);
