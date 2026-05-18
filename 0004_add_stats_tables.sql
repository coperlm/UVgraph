CREATE TABLE IF NOT EXISTS daily_stats (
  id SERIAL PRIMARY KEY,
  domain VARCHAR(255) NOT NULL,
  date DATE NOT NULL,
  site_pv INTEGER DEFAULT 0,
  site_uv INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(domain, date)
);

CREATE TABLE IF NOT EXISTS page_stats (
  id SERIAL PRIMARY KEY,
  domain VARCHAR(255) NOT NULL,
  page_path TEXT NOT NULL,
  date DATE NOT NULL,
  pv INTEGER DEFAULT 0,
  uv INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(domain, page_path, date)
);

-- 创建索引以加快查询
CREATE INDEX IF NOT EXISTS idx_daily_stats_domain ON daily_stats(domain);
CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(date);
CREATE INDEX IF NOT EXISTS idx_daily_stats_domain_date ON daily_stats(domain, date);

CREATE INDEX IF NOT EXISTS idx_page_stats_domain ON page_stats(domain);
CREATE INDEX IF NOT EXISTS idx_page_stats_date ON page_stats(date);
CREATE INDEX IF NOT EXISTS idx_page_stats_domain_date ON page_stats(domain, date);
CREATE INDEX IF NOT EXISTS idx_page_stats_path ON page_stats(page_path);
