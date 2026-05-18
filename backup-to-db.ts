/**
 * 备份脚本：将快照数据导入到 PostgreSQL
 * 
 * 用法：
 *   npx tsx scripts/backup-to-db.ts '{"date":"2026-05-19",...}'
 * 
 * 或从 GitHub Action 调用：
 *   npx tsx scripts/backup-to-db.ts '${{ steps.fetch.outputs.snapshot }}'
 */

import { db } from '@/db';
import { dailyStats, pageStats } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

interface SnapshotPage {
  path: string;
  pv: number;
  uv: number;
}

interface SnapshotDomain {
  domain: string;
  site_pv: number;
  site_uv: number;
  pages: SnapshotPage[];
}

interface Snapshot {
  date: string;
  timestamp: number;
  domains: SnapshotDomain[];
}

async function backupSnapshot(snapshot: Snapshot): Promise<void> {
  console.log(`[Backup] Starting backup for date: ${snapshot.date}`);
  console.log(`[Backup] Processing ${snapshot.domains.length} domain(s)...`);

  let domainCount = 0;
  let pageCount = 0;

  for (const domain of snapshot.domains) {
    // 备份全站统计
    try {
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

      domainCount++;
      console.log(
        `  ✓ ${domain.domain}: PV=${domain.site_pv}, UV=${domain.site_uv}`
      );
    } catch (error) {
      console.error(
        `  ✗ Failed to backup ${domain.domain}:`,
        error instanceof Error ? error.message : String(error)
      );
    }

    // 备份页面级统计
    for (const page of domain.pages) {
      // 注意：path 可能是 URL 编码的
      const decodedPath = decodeURIComponent(page.path);
      try {
        await db
          .insert(pageStats)
          .values({
            domain: domain.domain,
            pagePath: decodedPath,
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

        pageCount++;
      } catch (error) {
        console.warn(
          `  ⚠ Failed to backup page ${decodedPath}:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  }

  console.log(`[Backup] ✅ Completed!`);
  console.log(`  • Domains: ${domainCount}`);
  console.log(`  • Pages: ${pageCount}`);
}

// CLI 入口
async function main(): Promise<void> {
  const snapshotJson = process.argv[2];

  if (!snapshotJson) {
    console.error('❌ Usage: npx tsx scripts/backup-to-db.ts <snapshot-json>');
    console.error('Example: npx tsx scripts/backup-to-db.ts \'{"date":"2026-05-19",...}\'');
    process.exit(1);
  }

  try {
    const snapshot: Snapshot = JSON.parse(snapshotJson);

    // 验证快照数据结构
    if (!snapshot.date || !Array.isArray(snapshot.domains)) {
      throw new Error(
        'Invalid snapshot structure. Expected: {date, domains}'
      );
    }

    await backupSnapshot(snapshot);
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
