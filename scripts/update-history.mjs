import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const workspaceRoot = process.cwd();
const dataDir = path.join(workspaceRoot, 'UV', 'data');
const historyFilePath = path.join(dataDir, 'history.json');

const targetUrl = normalizeUrl(process.env.TARGET_URL || 'https://coperlm.github.io/');
const sitemapUrl = process.env.SITEMAP_URL || new URL('sitemap.xml', targetUrl).toString();
const statsApi = process.env.STATS_URL || 'https://vercount-l2e8.vercel.app/api/v2/stats';

function normalizeUrl(input) {
  const value = String(input || '').trim();
  if (!value) return 'https://coperlm.github.io/';
  return value.endsWith('/') ? value : `${value}/`;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function pageLabelFromPath(pagePath) {
  if (pagePath === '/') return '首页';
  const parts = pagePath.replace(/\/$/, '').split('/').filter(Boolean);
  const last = parts.at(-1) || pagePath;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

function parseSitemapUrls(xmlText) {
  const matches = [...xmlText.matchAll(/<loc>(.*?)<\/loc>/g)];
  return matches.map((match) => match[1].trim()).filter(Boolean);
}

function latestValue(series) {
  if (!Array.isArray(series) || series.length === 0) return 0;
  return Number(series[series.length - 1] ?? 0);
}

function extractSnapshot(payload) {
  const data = payload?.data ?? payload;
  const series = data?.series || {};

  return {
    site: {
      pv: latestValue(series.site_pv ?? data?.site_pv),
      uv: latestValue(series.site_uv ?? data?.site_uv),
    },
    page: {
      pv: latestValue(series.page_pv ?? data?.page_pv),
      uv: latestValue(series.page_uv ?? data?.page_uv),
    },
  };
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return response.text();
}

function uniquePagesFromUrls(urls) {
  const host = new URL(targetUrl).host;
  const pageMap = new Map();

  for (const rawUrl of urls) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.host !== host) {
        continue;
      }

      const pagePath = parsed.pathname || '/';
      if (!pageMap.has(pagePath)) {
        pageMap.set(pagePath, {
          path: pagePath,
          label: pageLabelFromPath(pagePath),
        });
      }
    } catch {
      continue;
    }
  }

  if (!pageMap.has('/')) {
    pageMap.set('/', { path: '/', label: '首页' });
  }

  return Array.from(pageMap.values()).sort((left, right) => {
    if (left.path === '/') return -1;
    if (right.path === '/') return 1;
    return left.label.localeCompare(right.label, 'zh-Hans-CN');
  });
}

async function loadExistingHistory() {
  try {
    const raw = await readFile(historyFilePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      siteUrl: parsed.siteUrl || targetUrl,
      generatedAt: parsed.generatedAt || '',
      pages: Array.isArray(parsed.pages) ? parsed.pages : [],
      snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
    };
  } catch {
    return {
      siteUrl: targetUrl,
      generatedAt: '',
      pages: [],
      snapshots: [],
    };
  }
}

async function buildSnapshot(pageUrls) {
  const date = formatDate(new Date());
  const siteStatsUrl = new URL(statsApi);
  siteStatsUrl.searchParams.set('url', targetUrl);
  siteStatsUrl.searchParams.set('type', 'both');

  const sitePayload = await fetchJson(siteStatsUrl.toString());
  const site = extractSnapshot(sitePayload).site;

  const pages = [];
  for (const page of pageUrls) {
    const statsUrl = new URL(statsApi);
    const pageUrl = new URL(page.path, targetUrl).toString();
    statsUrl.searchParams.set('url', pageUrl);
    statsUrl.searchParams.set('type', 'both');

    try {
      const payload = await fetchJson(statsUrl.toString());
      const snapshot = extractSnapshot(payload).page;
      pages.push({
        path: page.path,
        pv: snapshot.pv,
        uv: snapshot.uv,
      });
    } catch (error) {
      pages.push({
        path: page.path,
        pv: 0,
        uv: 0,
      });
      console.warn(`[history] Failed to fetch page stats for ${page.path}:`, error instanceof Error ? error.message : String(error));
    }
  }

  return {
    date,
    site,
    pages,
  };
}

async function main() {
  await mkdir(dataDir, { recursive: true });

  const existingHistory = await loadExistingHistory();

  let sitemapUrls = [];
  try {
    sitemapUrls = parseSitemapUrls(await fetchText(sitemapUrl));
  } catch (error) {
    console.warn(`[history] Failed to load sitemap:`, error instanceof Error ? error.message : String(error));
  }

  const discoveredPages = uniquePagesFromUrls(sitemapUrls);
  const mergedPages = new Map();

  for (const page of existingHistory.pages) {
    if (page?.path) {
      mergedPages.set(page.path, {
        path: page.path,
        label: page.label || pageLabelFromPath(page.path),
      });
    }
  }

  for (const page of discoveredPages) {
    mergedPages.set(page.path, page);
  }

  const snapshot = await buildSnapshot(Array.from(mergedPages.values()));
  const snapshots = Array.isArray(existingHistory.snapshots) ? existingHistory.snapshots.filter((item) => item?.date !== snapshot.date) : [];

  snapshots.push(snapshot);
  snapshots.sort((left, right) => left.date.localeCompare(right.date));

  const history = {
    siteUrl: targetUrl,
    generatedAt: new Date().toISOString(),
    pages: Array.from(mergedPages.values()),
    snapshots,
  };

  await writeFile(historyFilePath, `${JSON.stringify(history, null, 2)}\n`, 'utf8');
  console.log(`[history] Updated ${historyFilePath} with ${history.snapshots.length} snapshot(s) and ${history.pages.length} page(s).`);
}

main().catch((error) => {
  console.error('[history] Failed to update history:', error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});