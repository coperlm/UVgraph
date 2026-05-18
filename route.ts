import kv from '@/lib/kv';
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
  // 鉴权：验证 API Key
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

    // 获取所有已记录的域名
    let domains: string[] = [];
    try {
      domains = (await kv.smembers('domains')) || [];
    } catch (e) {
      // 如果还没有初始化 domains set，尝试从 Redis 键中推导
      try {
        const allKeys = await kv.keys('pv:site:*');
        domains = Array.from(
          new Set(
            allKeys
              .map((k) => {
                const parts = k.split(':');
                // 从 pv:site:<domain>:<date> 中提取 domain
                if (parts.length >= 4) {
                  return parts.slice(2, -1).join(':');
                }
                return null;
              })
              .filter(Boolean)
                        .filter((x): x is string => x !== null)
          )
        );
      } catch {
        console.warn('[Snapshot] No domains found in Redis');
      }
    }

    console.log(
      `[Snapshot] Processing ${domains.length} domain(s):`,
      domains
    );

    // 处理每个域名
    for (const domain of domains) {
      const sitePvKey = `pv:site:${domain}:${dateStr}`;
      const siteUvKey = `uv:site:${domain}:${dateStr}`;

      let sitePv = 0;
      let siteUv = 0;

      // 获取全站 PV
      try {
        const pvVal = await kv.get(sitePvKey);
        sitePv = pvVal ? Number(pvVal) : 0;
      } catch (e) {
        console.warn(`[Snapshot] Failed to fetch ${sitePvKey}:`, e);
      }

      // 获取全站 UV（使用 scard）
      try {
        siteUv = (await kv.scard(siteUvKey)) || 0;
      } catch (e) {
        console.warn(`[Snapshot] Failed to fetch ${siteUvKey}:`, e);
      }

      // 获取该域名下的所有页面数据
      let pageKeys: string[] = [];
      try {
        pageKeys = await kv.keys(`pv:page:${domain}:*:${dateStr}`);
      } catch (e) {
        console.warn(`[Snapshot] Failed to fetch page keys for ${domain}:`, e);
      }

      const pages = [];
      for (const pageKey of pageKeys) {
        // pageKey 格式: pv:page:<domain>:<encoded_path>:<date>
        // 例：pv:page:example.com:L2FyY2hpdmU%3D:2026-05-19
        const parts = pageKey.split(':');
        if (parts.length < 5) continue;

        const path = parts[3]; // 通常是 URL 编码的路径

        let pv = 0;
        let uv = 0;

        try {
          const pvVal = await kv.get(pageKey);
          pv = pvVal ? Number(pvVal) : 0;
        } catch (e) {
          console.warn(`[Snapshot] Failed to fetch ${pageKey}:`, e);
        }

        try {
          const uvKey = `uv:page:${domain}:${path}:${dateStr}`;
          uv = (await kv.scard(uvKey)) || 0;
        } catch (e) {
          console.warn(`[Snapshot] Failed to fetch UV for ${path}:`, e);
        }

        // 只记录有数据的页面
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

    console.log(
      `[Snapshot] Generated snapshot for ${dateStr} with ${snapshot.domains.length} domain(s)`
    );

    return NextResponse.json(snapshot);
  } catch (error) {
    console.error('[Snapshot] Error generating snapshot:', error);
    return NextResponse.json(
      {
        error: 'Failed to generate snapshot',
        message:
          error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
