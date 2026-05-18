const DEFAULT_TARGET = 'https://coperlm.github.io/';
const STATS_API = 'https://vercount-l2e8.vercel.app/api/v2/stats';
const CACHE_URL = './data/cache.json';

const elements = {
  targetUrl: document.getElementById('targetUrl'),
  refreshButton: document.getElementById('refreshButton'),
  totalPv: document.getElementById('totalPv'),
  totalUv: document.getElementById('totalUv'),
  pvDelta: document.getElementById('pvDelta'),
  uvDelta: document.getElementById('uvDelta'),
  peakDay: document.getElementById('peakDay'),
  peakValue: document.getElementById('peakValue'),
  dataSource: document.getElementById('dataSource'),
  lastUpdated: document.getElementById('lastUpdated'),
  statsTableBody: document.getElementById('statsTableBody'),
  chartCanvas: document.getElementById('statsChart'),
};

let chartInstance = null;

function formatNumber(value) {
  return new Intl.NumberFormat('zh-CN').format(Number(value) || 0);
}

function formatDateLabel(value) {
  if (!value) return '--';
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(parsed);
}

function normalizeTargetUrl(value) {
  const url = String(value || '').trim();
  if (!url) return DEFAULT_TARGET;
  return url.endsWith('/') ? url : `${url}/`;
}

function buildApiUrl(targetUrl) {
  const apiUrl = new URL(STATS_API);
  apiUrl.searchParams.set('url', targetUrl);
  apiUrl.searchParams.set('type', 'both');
  return apiUrl.toString();
}

function extractSeries(payload) {
  const data = payload?.data ?? payload;
  if (!data) {
    throw new Error('响应中没有可用数据。');
  }

  const dates = Array.isArray(data.dates) ? data.dates : [];
  const series = data.series || {};
  const sitePv = Array.isArray(series.site_pv) ? series.site_pv : Array.isArray(data.site_pv) ? data.site_pv : [];
  const siteUv = Array.isArray(series.site_uv) ? series.site_uv : Array.isArray(data.site_uv) ? data.site_uv : [];

  if (!dates.length || (!sitePv.length && !siteUv.length)) {
    throw new Error('接口返回格式不包含日期或时序数组。');
  }

  const rows = dates.map((date, index) => ({
    date,
    pv: Number(sitePv[index] ?? 0),
    uv: Number(siteUv[index] ?? 0),
  }));

  return {
    rows,
    sourceLabel: data.source || payload?.source || 'live-api',
    fetchedAt: payload?.timestamp ? new Date(payload.timestamp).toLocaleString('zh-CN') : new Date().toLocaleString('zh-CN'),
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    cache: 'no-store',
    ...options,
  });

  if (!response.ok) {
    throw new Error(`请求失败：HTTP ${response.status}`);
  }

  return response.json();
}

async function loadStats(targetUrl) {
  const liveUrl = buildApiUrl(targetUrl);
  try {
    const livePayload = await fetchJson(liveUrl);
    const parsed = extractSeries(livePayload);
    return { ...parsed, dataSource: '实时接口', liveUrl };
  } catch (liveError) {
    try {
      const cachePayload = await fetchJson(CACHE_URL);
      const parsed = extractSeries(cachePayload);
      return {
        ...parsed,
        dataSource: '同源缓存',
        liveUrl,
        cacheError: liveError instanceof Error ? liveError.message : String(liveError),
      };
    } catch (cacheError) {
      throw new Error(
        [
          liveError instanceof Error ? liveError.message : String(liveError),
          cacheError instanceof Error ? cacheError.message : String(cacheError),
        ].join(' / ')
      );
    }
  }
}

function renderTable(rows) {
  if (!rows.length) {
    elements.statsTableBody.innerHTML = '<tr><td colspan="3" class="empty">没有可展示的数据</td></tr>';
    return;
  }

  elements.statsTableBody.innerHTML = rows
    .slice()
    .reverse()
    .map(
      (row) => `
        <tr>
          <td>${row.date}</td>
          <td>${formatNumber(row.pv)}</td>
          <td>${formatNumber(row.uv)}</td>
        </tr>
      `
    )
    .join('');
}

function renderChart(rows) {
  const labels = rows.map((row) => formatDateLabel(row.date));
  const pvValues = rows.map((row) => row.pv);
  const uvValues = rows.map((row) => row.uv);

  const context = elements.chartCanvas.getContext('2d');
  const gradientPv = context.createLinearGradient(0, 0, 0, 420);
  gradientPv.addColorStop(0, 'rgba(56, 189, 248, 0.38)');
  gradientPv.addColorStop(1, 'rgba(56, 189, 248, 0)');

  const gradientUv = context.createLinearGradient(0, 0, 0, 420);
  gradientUv.addColorStop(0, 'rgba(74, 222, 128, 0.34)');
  gradientUv.addColorStop(1, 'rgba(74, 222, 128, 0)');

  if (chartInstance) {
    chartInstance.destroy();
  }

  chartInstance = new Chart(context, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'PV',
          data: pvValues,
          borderColor: '#38bdf8',
          backgroundColor: gradientPv,
          fill: true,
          tension: 0.36,
          borderWidth: 2.5,
          pointRadius: 2,
          pointHoverRadius: 5,
        },
        {
          label: 'UV',
          data: uvValues,
          borderColor: '#4ade80',
          backgroundColor: gradientUv,
          fill: true,
          tension: 0.36,
          borderWidth: 2.5,
          pointRadius: 2,
          pointHoverRadius: 5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          labels: {
            color: '#cbd5e1',
            usePointStyle: true,
            pointStyle: 'circle',
          },
        },
        tooltip: {
          backgroundColor: 'rgba(2, 6, 23, 0.96)',
          titleColor: '#f8fafc',
          bodyColor: '#dbeafe',
          borderColor: 'rgba(148, 163, 184, 0.22)',
          borderWidth: 1,
          padding: 12,
        },
      },
      scales: {
        x: {
          ticks: { color: '#94a3b8' },
          grid: { color: 'rgba(148, 163, 184, 0.08)' },
        },
        y: {
          ticks: { color: '#94a3b8' },
          grid: { color: 'rgba(148, 163, 184, 0.08)' },
        },
      },
    },
  });
}

function updateSummary(rows, dataSource, fetchedAt, liveUrl, cacheError) {
  const totalPv = rows.reduce((sum, row) => sum + row.pv, 0);
  const totalUv = rows.reduce((sum, row) => sum + row.uv, 0);
  const latest = rows[rows.length - 1] || { date: '--', pv: 0, uv: 0 };
  const peak = rows.reduce((best, current) => (current.pv > best.pv ? current : best), rows[0] || { date: '--', pv: 0, uv: 0 });
  const averageUv = rows.length ? Math.round(totalUv / rows.length) : 0;

  elements.totalPv.textContent = formatNumber(totalPv);
  elements.totalUv.textContent = formatNumber(totalUv);
  elements.pvDelta.textContent = `最新 ${latest.date}：PV ${formatNumber(latest.pv)}`;
  elements.uvDelta.textContent = `日均 UV ${formatNumber(averageUv)}，最新 UV ${formatNumber(latest.uv)}`;
  elements.peakDay.textContent = peak.date || '--';
  elements.peakValue.textContent = `峰值 PV ${formatNumber(peak.pv)}`;
  elements.dataSource.textContent = dataSource;
  elements.lastUpdated.textContent = `${fetchedAt || '刚刚'} · ${liveUrl}`;

  if (cacheError) {
    const banner = document.createElement('p');
    banner.className = 'error-banner';
    banner.textContent = `实时接口暂不可用，已回退到本地缓存。原始错误：${cacheError}`;
    elements.dataSource.parentElement.appendChild(banner);
  }
}

function clearErrorBanner() {
  document.querySelectorAll('.error-banner').forEach((node) => node.remove());
}

async function refreshDashboard() {
  clearErrorBanner();
  const targetUrl = normalizeTargetUrl(elements.targetUrl.value);
  elements.refreshButton.disabled = true;
  elements.refreshButton.textContent = '加载中...';
  elements.statsTableBody.innerHTML = '<tr><td colspan="3" class="empty">正在请求 Vercount 接口...</td></tr>';

  try {
    const stats = await loadStats(targetUrl);
    renderChart(stats.rows);
    renderTable(stats.rows);
    updateSummary(stats.rows, stats.dataSource, stats.fetchedAt, stats.liveUrl, stats.cacheError);
  } catch (error) {
    elements.statsTableBody.innerHTML = `<tr><td colspan="3" class="empty">${error instanceof Error ? error.message : String(error)}</td></tr>`;
    elements.totalPv.textContent = '--';
    elements.totalUv.textContent = '--';
    elements.pvDelta.textContent = '加载失败';
    elements.uvDelta.textContent = '加载失败';
    elements.peakDay.textContent = '--';
    elements.peakValue.textContent = '加载失败';
    elements.dataSource.textContent = '错误';
    elements.lastUpdated.textContent = '请检查接口或缓存是否可访问';
  } finally {
    elements.refreshButton.disabled = false;
    elements.refreshButton.textContent = '刷新图表';
  }
}

elements.targetUrl.value = DEFAULT_TARGET;
elements.refreshButton.addEventListener('click', refreshDashboard);
elements.targetUrl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    refreshDashboard();
  }
});

window.addEventListener('DOMContentLoaded', refreshDashboard);