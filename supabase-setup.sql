-- =============================
-- LayWri Supabase 데이터베이스 설정
-- =============================
-- Supabase Dashboard > SQL Editor에서 실행하세요.

-- 1. 메모 테이블
CREATE TABLE IF NOT EXISTS memos (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT DEFAULT '',
  content TEXT DEFAULT '',
  category TEXT,
  layers JSONB NOT NULL DEFAULT '[]',
  active_layer_id TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

-- 2. 카테고리 테이블
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  UNIQUE(user_id, name)
);

-- 3. 인덱스
CREATE INDEX IF NOT EXISTS idx_memos_user_id ON memos(user_id);
CREATE INDEX IF NOT EXISTS idx_memos_updated_at ON memos(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_categories_user_id ON categories(user_id);

-- 4. Row Level Security (RLS) 활성화
ALTER TABLE memos ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

-- 5. RLS 정책: 본인 데이터만 접근 가능
CREATE POLICY "Users can manage own memos"
  ON memos FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can manage own categories"
  ON categories FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
