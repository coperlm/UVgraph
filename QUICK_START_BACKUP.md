# 🚀 快速开始：数据备份实现指南

> 本文档指导如何从零开始实现每日自动备份。预计实施时间：**1-2 小时**

## 第一步：添加环境变量

### 1.1 本地开发环境

更新 `.env.local`:
```bash
# 现有的保持不变...

# 新增：备份配置
ADMIN_API_KEY="your-super-secret-admin-key-min-32-chars-please"
SNAPSHOT_RETENTION_DAYS="30"
```

生成安全的 API Key：
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 1.2 Vercel 部署环境

在 [Vercel Dashboard](https://vercel.com/projects) 中：
1. 选择 `vercount` 项目
2. 进入 **Settings** → **Environment Variables**
3. 添加：
   - 名称：`ADMIN_API_KEY`
   - 值：（同本地 key）
   - 应用到：Production + Preview + Development

---

## 第二步：实现后端快照接口

### 2.1 创建快照路由文件

`src/app/api/admin/snapshot/route.ts`:

```typescript
import { kv } from '@/lib/kv';
import { NextResponse } from 'next/server';

interface Snapshot {
  date: string;
  timestamp: number;
  domains: Array<{
    domain: string;
    site_pv: number;
    site_uv: number;
    pages: Array<{ path: string; pv: number; uv: number }>;
  }>;
}

export async function GET(req: Request) {
  // 鉴权
  const apiKey = req.headers.get('x-api-key');
  if (apiKey !== process.env.ADMIN_API_KEY) {
    return NextResponse.json(
      { error: 'Unauthorized: Invalid API key' },
      { status: 401 }
    );
  }

  try {
    // 使用本地时间（而非 UTC）生成日期
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const date = String(now.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${date}`; // YYYY-MM-DD

    const snapshot: Snapshot = {
      date: dateStr,
      timestamp: Date.now(),
      domains: [],
    };

    // 获取所有已记录的域名（假设存在 'domains' set）
    let domains: string[] = [];
    try {
      domains = (await kv.smembers('domains')) || [];
    } catch {
      // 如果还没有初始化 domains set，尝试从 Redis 中推导
      const allKeys = await kv.keys('pv:site:*');
      domains = Array.from(new Set(
        allKeys
          .map(k => {
            const parts = k.split(':');
            return parts.slice(2, parts.length - 1).join(':'); // 提取域名部分
          })
      )).filter(Boolean);
    }

    console.log(`[Snapshot] Found ${domains.length} domains:`, domains);

    for (const domain of domains) {
      const sitePvKey = `pv:site:${domain}:${dateStr}`;
      const siteUvKey = `uv:site:${domain}:${dateStr}`;

      let sitePv = 0;
      let siteUv = 0;

      try {
        const pvVal = await kv.get(sitePvKey);
        sitePv = pvVal ? Number(pvVal) : 0;
      } catch (e) {
        console.warn(`Failed to fetch ${sitePvKey}:`, e);
      }

      try {
        siteUv = (await kv.scard(siteUvKey)) || 0;
      } catch (e) {
        console.warn(`Failed to fetch ${siteUvKey}:`, e);
      }

      // 获取该域名下的所有页面数据
      let pageKeys: string[] = [];
      try {
        pageKeys = await kv.keys(`pv:page:${domain}:*:${dateStr}`);
      } catch (e) {
        console.warn(`Failed to fetch page keys for ${domain}:`, e);
      }

      const pages = [];
      for (const pageKey of pageKeys) {
        // pageKey 格式: pv:page:<domain>:<path>:<date>
        const parts = pageKey.split(':');
        const pathParts = parts.slice(3, -1);
        const path = pathParts.join(':'); // 路径可能包含冒号

        let pv = 0;
        let uv = 0;

        try {
          const pvVal = await kv.get(pageKey);
          pv = pvVal ? Number(pvVal) : 0;
        } catch (e) {
          console.warn(`Failed to fetch ${pageKey}:`, e);
        }

        try {
          const uvKey = `uv:page:${domain}:${path}:${dateStr}`;
          uv = (await kv.scard(uvKey)) || 0;
        } catch (e) {
          console.warn(`Failed to fetch UV for ${path}:`, e);
        }

        if (pv > 0 || uv > 0) {
          pages.push({ path, pv, uv });
        }
      }

      snapshot.domains.push({
        domain,
        site_pv: sitePv,
        site_uv: siteUv,
        pages,
      });
    }

    console.log(`[Snapshot] Generated snapshot for ${dateStr}:`, JSON.stringify(snapshot));
    return NextResponse.json(snapshot);
  } catch (error) {
    console.error('[Snapshot] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to generate snapshot',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
```

### 2.2 本地测试

```bash
# 注意：先启动本地开发服务
pnpm dev

# 新开终端，测试快照接口
curl -H "x-api-key: your-super-secret-admin-key-min-32-chars-please" \
  http://localhost:3000/api/admin/snapshot | jq
```

**预期输出**:
```json
{
  "date": "2026-05-19",
  "timestamp": 1716104400000,
  "domains": [
    {
      "domain": "example.com",
      "site_pv": 100,
      "site_uv": 50,
      "pages": [
        {
          "path": "/page1",
          "pv": 20,
          "uv": 10
        }
      ]
    }
  ]
}
```

---

## 第三步：设置 GitHub Action

### 3.1 创建工作流文件

`.github/workflows/daily-stats-snapshot.yml`:

```yaml
name: 📊 Daily Stats Snapshot

on:
  schedule:
    # 每天 02:00 UTC 执行
    # 如果服务器在其他时区，请相应调整
    # 时区参考：https://www.timeanddate.com/zones/all
    - cron: '0 2 * * *'
  
  workflow_dispatch:  # 允许手动触发

permissions:
  contents: write

jobs:
  snapshot:
    runs-on: ubuntu-latest
    
    steps:
      - name: ✅ Checkout repository
        uses: actions/checkout@v4
        with:
          ref: main

      - name: 📥 Fetch snapshot from API
        id: fetch
        env:
          API_KEY: ${{ secrets.VERCOUNT_ADMIN_API_KEY }}
          SNAPSHOT_URL: https://vercount-l2e8.vercel.app/api/admin/snapshot
        run: |
          echo "🔍 Fetching snapshot from API..."
          RESPONSE=$(curl -s -w "\n%{http_code}" \
            -H "x-api-key: $API_KEY" \
            "$SNAPSHOT_URL")
          
          HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
          BODY=$(echo "$RESPONSE" | sed '$d')
          
          if [ "$HTTP_CODE" != "200" ]; then
            echo "❌ API returned HTTP $HTTP_CODE"
            echo "Response: $BODY"
            exit 1
          fi
          
          # 验证是否为有效 JSON
          if ! echo "$BODY" | jq empty 2>/dev/null; then
            echo "❌ Response is not valid JSON"
            echo "Response: $BODY"
            exit 1
          fi
          
          # 保存到输出
          echo "snapshot<<EOF" >> $GITHUB_OUTPUT
          echo "$BODY" >> $GITHUB_OUTPUT
          echo "EOF" >> $GITHUB_OUTPUT
          
          echo "✅ Snapshot fetched successfully"
          echo "$BODY" | jq '.domains | length' | xargs echo "📊 Domains found:"

      - name: 💾 Save snapshot as CSV
        run: |
          mkdir -p data/daily-snapshots
          DATE=$(date +%Y-%m-%d)
          FILE="data/daily-snapshots/$DATE.csv"
          
          echo 'Domain,Site PV,Site UV,Date' > "$FILE"
          
          echo '${{ steps.fetch.outputs.snapshot }}' | jq -r '.domains[] | 
            "\(.domain),\(.site_pv),\(.site_uv),\(.date // .)'  \
            >> "$FILE"
          
          wc -l "$FILE" | awk '{print "✓ Saved", $1, "lines to CSV"}'

      - name: 📤 Commit & Push
        run: |
          git config user.name "Vercount Snapshot Bot"
          git config user.email "bot@vercount.io"
          
          if git diff --quiet; then
            echo "ℹ️ No changes to commit"
          else
            git add data/daily-snapshots/
            git commit -m "📊 Daily snapshot: $(date +%Y-%m-%d)"
            git push origin main
            echo "✅ Pushed snapshot to main branch"
          fi

      - name: ❌ Notify on failure
        if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const date = new Date().toISOString().split('T')[0];
            
            github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: `⚠️ Daily snapshot failed - ${date}`,
              body: `The scheduled stats snapshot failed on ${date}.\n\nCheck the [workflow run](${context.payload.repository.html_url}/actions/runs/${context.runId}).`
            });
```

### 3.2 在 GitHub Secrets 中配置密钥

1. 打开 GitHub 仓库 → **Settings** → **Secrets and variables** → **Actions**
2. 点击 **New repository secret**
3. 添加：
   - **Name**: `VERCOUNT_ADMIN_API_KEY`
   - **Value**: （粘贴你的 ADMIN_API_KEY）

---

## 第四步：创建 GitHub Pages 展示版（可选）

如果想在 GitHub Pages 上展示数据，创建简单的可视化页面：

`.github/workflows/generate-dashboard.yml`:

```yaml
name: 📈 Generate Dashboard

on:
  workflow_run:
    workflows: ["📊 Daily Stats Snapshot"]
    types: [completed]
  
  workflow_dispatch:

permissions:
  contents: write

jobs:
  dashboard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: 📊 Generate HTML Dashboard
        run: |
          mkdir -p docs
          cat > docs/index.html << 'EOF'
          <!DOCTYPE html>
          <html>
          <head>
            <title>Vercount Stats</title>
            <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
            <style>
              body { font-family: sans-serif; margin: 20px; background: #f5f5f5; }
              .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; }
              h1 { color: #333; }
              .chart-container { position: relative; height: 300px; margin: 20px 0; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>📊 Vercount Statistics Dashboard</h1>
              <p>Last updated: <span id="updated"></span></p>
              <div class="chart-container">
                <canvas id="statsChart"></canvas>
              </div>
            </div>
            <script>
              // 从 CSV 读取最新数据并绘制图表
              fetch('https://raw.githubusercontent.com/YOUR_ORG/vercount/main/data/daily-snapshots')
                .then(r => r.text())
                .then(text => {
                  // 解析 CSV 并绘制
                  document.getElementById('updated').textContent = new Date().toLocaleString();
                })
                .catch(err => console.error('Failed to load data:', err));
            </script>
          </body>
          </html>
          EOF

      - name: 🚀 Deploy to GitHub Pages
        uses: actions/upload-pages-artifact@v2
        with:
          path: docs

      - name: 📍 Publish to Pages
        uses: actions/deploy-pages@v3
```

---

## 第五步：验证部署

### 5.1 测试快照接口

```bash
# 在已部署的 Vercel 上测试
curl -H "x-api-key: your-super-secret-admin-key-min-32-chars-please" \
  https://vercount-l2e8.vercel.app/api/admin/snapshot | jq .
```

预期状态码：`200`

### 5.2 验证 GitHub Action

1. 进入仓库 **Actions** 标签页
2. 找到 `daily-stats-snapshot` 工作流
3. 点击 **Run workflow** → **Run**
4. 等待完成（通常 < 1 分钟）
5. 验证 `data/daily-snapshots/YYYY-MM-DD.csv` 文件是否被创建/更新

### 5.3 检查历史快照

```bash
# 列出已生成的快照
git log --oneline data/daily-snapshots/ | head -10

# 查看最新快照内容
cat data/daily-snapshots/$(date +%Y-%m-%d).csv
```

---

## 第六步：PostgreSQL 长期存储（可选但推荐）

### 6.1 创建数据库表

迁移文件 `drizzle/0004_add_daily_stats.sql`:

```sql
CREATE TABLE daily_stats (
  id SERIAL PRIMARY KEY,
  domain VARCHAR(255) NOT NULL,
  date DATE NOT NULL,
  site_pv INTEGER DEFAULT 0,
  site_uv INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(domain, date)
);

CREATE INDEX idx_daily_stats_domain ON daily_stats(domain);
CREATE INDEX idx_daily_stats_date ON daily_stats(date);
```

### 6.2 执行迁移

```bash
# 本地测试
pnpm db:migrate

# Vercel 上（通过数据库管理工具或连接字符串）
psql $DATABASE_URL < drizzle/0004_add_daily_stats.sql
```

---

## ⚠️ 常见问题排查

### Q: "401 Unauthorized" 错误

**原因**: API Key 不匹配
- 检查 GitHub Secrets 中的 `VERCOUNT_ADMIN_API_KEY`
- 确保与 Vercel 环境变量 `ADMIN_API_KEY` 一致
- 本地测试时，检查 `.env.local` 中的值

### Q: "API returned HTTP 500"

**原因**: 服务端错误
- 检查 Vercel 日志：`vercel logs vercount-l2e8 --follow`
- 确保 Redis/KV 连接正常
- 确保 `domains` 集合已初始化

### Q: "No changes to commit"

**原因**: 今天没有新访问数据
- 这是正常的。快照工作流成功运行了，但数据全是 0
- 解决方案：手动触发 POST /api/v2/log 生成测试数据

### Q: CSV 文件格式错误

**原因**: `jq` 选择器不正确
- 修改 `.yml` 中的 jq 语句，确保与实际 JSON 结构匹配
- 手动测试：`curl ... | jq '.domains[]'`

---

## ✅ 完整检查清单

按以下顺序完成：

- [ ] 添加 `.env.local` 中的 `ADMIN_API_KEY`
- [ ] 创建 `src/app/api/admin/snapshot/route.ts`
- [ ] 本地启动 `pnpm dev` 并测试快照接口
- [ ] 在 Vercel 环境中添加 `ADMIN_API_KEY`
- [ ] 创建 `.github/workflows/daily-stats-snapshot.yml`
- [ ] 在 GitHub Secrets 中添加 `VERCOUNT_ADMIN_API_KEY`
- [ ] 手动运行一次工作流验证
- [ ] 检查 `data/daily-snapshots/` 目录中的 CSV 文件
- [ ] 设置每日定时任务（验证 cron 是否触发）
- [ ] （可选）创建 PostgreSQL 表并实现备份脚本

---

## 📞 获取帮助

如有问题，检查以下资源：

- [GitHub Actions 文档](https://docs.github.com/en/actions)
- [Vercel 环境变量](https://vercel.com/docs/projects/environment-variables)
- [Upstash Redis API](https://upstash.com/docs/redis/features/restapi)
- 项目根目录的 `USAGE_AND_STORAGE_PLAN.md` 获取更多详细信息

