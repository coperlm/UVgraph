# Vercount 时序数据收集与长期存储规划

## 📊 当前架构与功能

### 实时 API 端点

#### 1. **计数更新** - `POST /api/v2/log`
```bash
curl -X POST https://vercount-l2e8.vercel.app/api/v2/log \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/page1",
    "browserToken": "fingerprint_token"
  }'
```

**响应** (成功):
```json
{
  "status": "success",
  "message": "Data updated successfully",
  "data": {
    "site_uv": 301,
    "site_pv": 721,
    "page_pv": 45,
    "page_uv": 23
  }
}
```

**数据流**:
- 增量更新 Redis 中的 `pv:site`, `uv:site:*`, `pv:page:*`, `uv:page:*`
- **自动记录** 当日日期的计数到 `pv:site:<domain>:YYYY-MM-DD` 等日期键
- 同步返回最新的全局计数

---

#### 2. **时序查询** - `GET /api/v2/stats`
```bash
# 查询指定 URL 的时序数据（最近 30 天）
curl "https://vercount-l2e8.vercel.app/api/v2/stats?url=https://example.com&type=both"

# type 参数选项:
# - both       : 返回 site + page 数据
# - site       : 仅返回全站数据
# - page       : 仅返回该页面数据
```

**响应** (示例):
```json
{
  "status": "success",
  "message": "OK",
  "data": {
    "dates": ["2026-04-19", "2026-04-20", ..., "2026-05-18"],
    "series": {
      "site_pv": [100, 110, 120, ...],
      "site_uv": [50, 55, 60, ...],
      "page_pv": [10, 12, 14, ...],
      "page_uv": [5, 6, 7, ...]
    }
  }
}
```

**当前限制**:
- 固定返回最近 **30 天** 的数据
- 不支持自定义日期范围（可改进）

---

## 🔄 推荐的定期收集方案

### 方案 A：GitHub Action 定时快照

**目标**: 每天将 Redis 快照存储到 PostgreSQL/CSV，保留完整历史

#### 实现步骤

**1. 创建后端新端点** - `GET /api/admin/snapshot`

添加到 `src/app/api/admin/snapshot/route.ts`:
```typescript
import { kv } from '@/lib/kv';
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const apiKey = req.headers.get('x-api-key');
  if (apiKey !== process.env.ADMIN_API_KEY) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const date = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD
  
  // 扫描所有 Redis key 并导出日期快照
  const snapshot = {
    date,
    timestamp: Date.now(),
    domains: [] as {
      domain: string;
      site_pv: number;
      site_uv: number;
      pages: Array<{ path: string; pv: number; uv: number }>;
    }[]
  };

  // 获取所有注册的域名
  const domains = await kv.smembers('domains') || [];
  
  for (const domain of domains) {
    const sitePvKey = `pv:site:${domain}:${date}`;
    const siteUvKey = `uv:site:${domain}:${date}`;
    
    const sitePv = await kv.get(sitePvKey) || 0;
    const siteUv = (await kv.scard(siteUvKey)) || 0;

    // 获取该域名下的所有页面
    const pageKeys = await kv.keys(`pv:page:${domain}:*:${date}`);
    const pages = [];
    
    for (const pageKey of pageKeys) {
      const path = pageKey.split(':')[2];
      const pv = await kv.get(pageKey) || 0;
      const uvKey = `uv:page:${domain}:${path}:${date}`;
      const uv = (await kv.scard(uvKey)) || 0;
      pages.push({ path, pv, uv });
    }

    snapshot.domains.push({
      domain,
      site_pv: sitePv,
      site_uv: siteUv,
      pages
    });
  }

  return NextResponse.json(snapshot);
}
```

**2. 创建 GitHub Action**

`.github/workflows/daily-snapshot.yml`:
```yaml
name: Daily Stats Snapshot

on:
  schedule:
    # 每天 UTC 时间 2:00 执行（可根据服务器时区调整）
    - cron: '0 2 * * *'
  workflow_dispatch:

jobs:
  snapshot:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Fetch daily snapshot
        id: snapshot
        run: |
          SNAPSHOT=$(curl -s -H "x-api-key: ${{ secrets.VERCOUNT_ADMIN_KEY }}" \
            https://vercount-l2e8.vercel.app/api/admin/snapshot)
          echo "snapshot=$SNAPSHOT" >> $GITHUB_OUTPUT

      - name: Store snapshot as CSV
        run: |
          mkdir -p data/daily-snapshots
          DATE=$(date +%Y-%m-%d)
          echo '${{ steps.snapshot.outputs.snapshot }}' | jq -r '.domains[] | "\(.domain),\(.site_pv),\(.site_uv)"' \
            > data/daily-snapshots/$DATE.csv

      - name: Upload to GitHub (via Gist or repo)
        run: |
          git config user.name "GitHub Bot"
          git config user.email "bot@github.com"
          git add data/daily-snapshots/
          git commit -m "📊 Daily snapshot: $(date +%Y-%m-%d)" || echo "No changes"
          git push

      - name: Backup to PostgreSQL (optional)
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: |
          npx tsx scripts/backup-to-db.ts '${{ steps.snapshot.outputs.snapshot }}'
```

**3. PostgreSQL 表设计**

迁移文件 `drizzle/0004_add_daily_stats.sql`:
```sql
CREATE TABLE daily_stats (
  id SERIAL PRIMARY KEY,
  domain VARCHAR(255) NOT NULL,
  date DATE NOT NULL,
  site_pv INTEGER DEFAULT 0,
  site_uv INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(domain, date)
);

CREATE TABLE page_stats (
  id SERIAL PRIMARY KEY,
  domain VARCHAR(255) NOT NULL,
  page_path TEXT NOT NULL,
  date DATE NOT NULL,
  pv INTEGER DEFAULT 0,
  uv INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(domain, page_path, date)
);

CREATE INDEX idx_daily_stats_domain_date ON daily_stats(domain, date);
CREATE INDEX idx_page_stats_domain_date ON page_stats(domain, date);
```

对应 Drizzle schema (`src/db/schema.ts`):
```typescript
import { sql } from 'drizzle-orm';
import { pgTable, serial, varchar, integer, date, timestamp } from 'drizzle-orm/pg-core';

export const dailyStats = pgTable('daily_stats', {
  id: serial('id').primaryKey(),
  domain: varchar('domain', { length: 255 }).notNull(),
  date: date('date').notNull(),
  sitePv: integer('site_pv').default(0),
  siteUv: integer('site_uv').default(0),
  createdAt: timestamp('created_at').default(sql`now()`),
});

export const pageStats = pgTable('page_stats', {
  id: serial('id').primaryKey(),
  domain: varchar('domain', { length: 255 }).notNull(),
  pagePath: varchar('page_path', { length: 1024 }).notNull(),
  date: date('date').notNull(),
  pv: integer('pv').default(0),
  uv: integer('uv').default(0),
  createdAt: timestamp('created_at').default(sql`now()`),
});
```

---

## 💾 长期数据存储策略

### 当前状态
- **Redis (Upstash)**: 只存储最近 30 天的滚动窗口
- **问题**: 30 天后数据自动过期，无法追溯历史

### 推荐分层存储方案

| 存储层 | 时间范围 | 用途 | 技术 |
|------|--------|------|------|
| **热数据 (L1)** | 最近 30 天 | 实时查询、仪表板 | Redis (Upstash) |
| **温数据 (L2)** | 31 天 ~ 2 年 | 分析、报表、历史对比 | PostgreSQL |
| **冷数据 (L3)** | 2+ 年 | 归档、长期统计 | S3/Backblaze/GitHub (CSV) |

### 实现步骤

#### Step 1: 配置环境变量

`.env.local` 新增:
```bash
# 定时快照配置
ADMIN_API_KEY=your-secure-admin-key-here
SNAPSHOT_RETENTION_DAYS=30
DATABASE_URL=postgresql://user:pass@host/db

# 可选：S3 冷存储
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET=vercount-backups
```

#### Step 2: 备份脚本

`scripts/backup-to-db.ts`:
```typescript
import { db } from '@/db';
import { dailyStats, pageStats } from '@/db/schema';
import { sql } from 'drizzle-orm';

interface SnapshotData {
  date: string;
  domains: Array<{
    domain: string;
    site_pv: number;
    site_uv: number;
    pages: Array<{ path: string; pv: number; uv: number }>;
  }>;
}

export async function backupSnapshot(snapshot: SnapshotData) {
  for (const domain of snapshot.domains) {
    // 插入或更新全站统计
    await db
      .insert(dailyStats)
      .values({
        domain: domain.domain,
        date: snapshot.date,
        sitePv: domain.site_pv,
        siteUv: domain.site_uv,
      })
      .onConflictDoUpdate({
        target: [dailyStats.domain, dailyStats.date],
        set: {
          sitePv: domain.site_pv,
          siteUv: domain.site_uv,
        },
      });

    // 插入页面级统计
    for (const page of domain.pages) {
      await db
        .insert(pageStats)
        .values({
          domain: domain.domain,
          pagePath: page.path,
          date: snapshot.date,
          pv: page.pv,
          uv: page.uv,
        })
        .onConflictDoUpdate({
          target: [pageStats.domain, pageStats.pagePath, pageStats.date],
          set: {
            pv: page.pv,
            uv: page.uv,
          },
        });
    }
  }

  console.log(`✓ Backup completed for ${snapshot.date}`);
}

// 从 GitHub Action 调用
if (require.main === module) {
  const snapshot = JSON.parse(process.argv[2]);
  backupSnapshot(snapshot).catch(console.error);
}
```

#### Step 3: 历史查询 API

`src/app/api/v2/history/route.ts`:
```typescript
import { db } from '@/db';
import { dailyStats, pageStats } from '@/db/schema';
import { between, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const domain = searchParams.get('domain');
  const startDate = searchParams.get('start'); // YYYY-MM-DD
  const endDate = searchParams.get('end');     // YYYY-MM-DD
  const type = searchParams.get('type') || 'site'; // site | page | all

  if (!domain || !startDate || !endDate) {
    return NextResponse.json(
      { error: 'Missing required params: domain, start, end' },
      { status: 400 }
    );
  }

  if (type === 'site' || type === 'all') {
    const data = await db
      .select()
      .from(dailyStats)
      .where(
        eq(dailyStats.domain, domain) &&
        between(dailyStats.date, startDate, endDate)
      )
      .orderBy(dailyStats.date);

    return NextResponse.json({ status: 'success', data });
  }

  if (type === 'page') {
    const path = searchParams.get('path');
    if (!path) {
      return NextResponse.json(
        { error: 'Missing path param for page query' },
        { status: 400 }
      );
    }

    const data = await db
      .select()
      .from(pageStats)
      .where(
        eq(pageStats.domain, domain) &&
        eq(pageStats.pagePath, path) &&
        between(pageStats.date, startDate, endDate)
      )
      .orderBy(pageStats.date);

    return NextResponse.json({ status: 'success', data });
  }
}
```

---

## 📈 完整的数据生命周期

```
┌─────────────────────────────────────────────────────────────┐
│              用户访问网站 (客户端 /js/client.min.js)          │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
        ┌──────────────────────────────────┐
        │     POST /api/v2/log             │
        │  (实时计数更新)                   │
        └──────────────────┬───────────────┘
                           │
                ┌──────────┴──────────┐
                ▼                     ▼
        ┌─────────────────┐  ┌─────────────────┐
        │  Redis (L1)     │  │  记录日期键      │
        │  (Hot - 30d)    │  │  pv:xx:YYYY-MM-DD
        │                 │  │  uv:xx:YYYY-MM-DD
        │  - site_pv      │  │                 │
        │  - site_uv      │  └────────┬────────┘
        │  - page_*       │           │
        └────────┬────────┘           │
                 │                    │
                 │◄───────────────────┘
                 │
        ┌────────▼─────────────────────────┐
        │  每天凌晨 2:00 (GitHub Action)    │
        │  GET /api/admin/snapshot         │
        │  (定时快照)                       │
        └────────┬─────────────────────────┘
                 │
        ┌────────▼────────────────┐
        │  PostgreSQL (L2)        │
        │  (Warm - 31d ~ 2y)      │
        │                         │
        │  - daily_stats 表       │
        │  - page_stats 表        │
        └────────┬────────────────┘
                 │
        ┌────────▼───────────────────┐
        │  S3 / Backblaze (L3)       │
        │  (Cold - 2y+)             │
        │  每月导出 CSV              │
        └───────────────────────────┘
```

---

## 🔧 GitHub Action 配置模板

### 完整的每日快照工作流

`.github/workflows/stats-snapshot.yml`:
```yaml
name: 📊 Daily Stats Snapshot

on:
  schedule:
    - cron: '0 2 * * *'  # 每天 UTC 2:00
  workflow_dispatch:      # 支持手动触发

permissions:
  contents: write

jobs:
  snapshot:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'pnpm'

      - name: Install pnpm
        run: npm install -g pnpm

      - name: Fetch snapshot from API
        id: fetch
        run: |
          SNAPSHOT=$(curl -s \
            -H "x-api-key: ${{ secrets.VERCOUNT_ADMIN_KEY }}" \
            https://vercount-l2e8.vercel.app/api/admin/snapshot)
          
          if [ -z "$SNAPSHOT" ] || echo "$SNAPSHOT" | grep -q "error"; then
            echo "❌ Snapshot fetch failed"
            exit 1
          fi
          
          echo "snapshot=$SNAPSHOT" >> $GITHUB_OUTPUT
          echo "✓ Snapshot fetched successfully"

      - name: Backup to PostgreSQL
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: |
          npx tsx scripts/backup-to-db.ts '${{ steps.fetch.outputs.snapshot }}'

      - name: Generate CSV report
        run: |
          mkdir -p data/daily-snapshots
          DATE=$(date +%Y-%m-%d)
          echo '${{ steps.fetch.outputs.snapshot }}' | \
            jq -r '.domains[] | [.domain, .site_pv, .site_uv] | @csv' \
            > data/daily-snapshots/$DATE.csv

      - name: Commit & Push
        run: |
          git config user.name "Vercount Bot"
          git config user.email "bot@vercount.local"
          git add data/daily-snapshots/ || true
          git commit -m "📊 Snapshot: $(date +%Y-%m-%d)" || echo "No changes"
          git push origin main

      - name: Notify on failure
        if: failure()
        uses: actions/github-script@v6
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '❌ Daily snapshot failed on ' + new Date().toISOString()
            })
```

---

## 📋 环境变量清单

更新 `.env.example`:
```bash
# === 现有配置 ===
DATABASE_URL=postgresql://user:pass@localhost/vercount
KV_REST_API_URL=https://xxxx-xxxx.upstash.io
KV_REST_API_TOKEN=xxxxx
GITHUB_CLIENT_ID=xxxxx
GITHUB_CLIENT_SECRET=xxxxx
BETTER_AUTH_URL=http://localhost:3000
BETTER_AUTH_SECRET=xxxxx

# === 新增：快照 & 备份 ===
ADMIN_API_KEY=your-secure-admin-key-here-min-32-chars-recommended
SNAPSHOT_RETENTION_DAYS=30

# === 可选：S3 冷存储 ===
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=xxxxx
AWS_SECRET_ACCESS_KEY=xxxxx
S3_BUCKET=vercount-archives

# === 可选：邮件通知 ===
SENDGRID_API_KEY=xxxxx
NOTIFICATION_EMAIL=admin@example.com
```

---

## ✅ 实现检查清单

- [ ] 实现 `/api/admin/snapshot` 端点
- [ ] 新增 PostgreSQL 迁移 & Drizzle Schema
- [ ] 创建 `scripts/backup-to-db.ts`
- [ ] 实现 `/api/v2/history` 查询接口
- [ ] 添加 `.github/workflows/stats-snapshot.yml`
- [ ] 在 Vercel/GitHub Secrets 中配置 `ADMIN_API_KEY` 和 `DATABASE_URL`
- [ ] 本地测试：`node scripts/backup-to-db.ts <snapshot-json>`
- [ ] 部署到 main 分支
- [ ] 验证第一次快照成功

---

## 🎯 使用示例

### 实时查询（30 天）
```bash
curl "https://vercount-l2e8.vercel.app/api/v2/stats?url=https://blog.example.com&type=both"
```

### 历史查询（任意日期范围）
```bash
curl "https://vercount-l2e8.vercel.app/api/v2/history?domain=blog.example.com&start=2024-01-01&end=2025-12-31&type=site"
```

### 导出为前端图表（本地处理）
```javascript
// 获取最近 90 天数据
fetch('https://vercount-l2e8.vercel.app/api/v2/history?domain=blog.example.com&start=2026-02-18&end=2026-05-19&type=all')
  .then(r => r.json())
  .then(data => {
    // 用 Chart.js / ECharts / Recharts 绘制
    renderChart(data);
  });
```

---

## 常见问题

**Q: Redis 30 天后数据会消失吗？**  
A: 是的。但通过上述方案，每天的数据都会被快照到 PostgreSQL，所以历史数据永久保留。

**Q: 如何手动触发备份？**  
A: 在 GitHub Actions 页面选择 `stats-snapshot` → "Run workflow" → "Run"。

**Q: 支持多个域名吗？**  
A: 完全支持。快照会自动扫描所有注册的域名并分别备份。

**Q: 可以从某个日期恢复数据吗？**  
A: 可以。直接从 PostgreSQL 查询，或从 GitHub 历史记录中的 CSV 文件恢复。

