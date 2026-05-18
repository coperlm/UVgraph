const HISTORY_URL = './data/history.json';

const elements = {
  rangeSelect: document.getElementById('rangeSelect'),
  pageSelect: document.getElementById('pageSelect'),
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
  chartTitle: document.getElementById('chartTitle'),
  chartSubtitle: document.getElementById('chartSubtitle'),
};

let chartInstance = null;
let appState = {
  history: { siteUrl: '', generatedAt: '', pages: [], snapshots: [] },
  selectedRange: '30',
  selectedPage: 'all',
};

function formatNumber(value) {
  return new Intl.NumberFormat('zh-CN').format(Number(value) || 0);
}

function formatDateLabel(value) {
  if (!value) return '--';
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(parsed);
}

function formatPageLabel(path) {
  if (path === 'all') return '全站';
  if (path === '/') return '首页';
  return path.replace(/\/$/, '').split('/').filter(Boolean).pop() || path;
}

function normalizeSnapshot(snapshot) {
  return {
    date: snapshot.date,
    site: {
      pv: Number(snapshot.site?.pv ?? snapshot.site_pv ?? 0),
      uv: Number(snapshot.site?.uv ?? snapshot.site_uv ?? 0),
    },
    pages: Array.isArray(snapshot.pages)
      ? snapshot.pages.map((page) => ({
          path: page.path,
          pv: Number(page.pv ?? 0),
          uv: Number(page.uv ?? 0),
        }))
      : [],
  };
}

function normalizeHistory(history) {
  const normalizedSnapshots = Array.isArray(history?.snapshots)
    ? history.snapshots.map(normalizeSnapshot).filter((snapshot) => snapshot.date)
    : [];

  const pageMap = new Map();
  const declaredPages = Array.isArray(history?.pages) ? history.pages : [];

  declaredPages.forEach((page) => {
    if (page?.path) {
      pageMap.set(page.path, {
        path: page.path,
        label: page.label || formatPageLabel(page.path),
      });
    }
  });

  normalizedSnapshots.forEach((snapshot) => {
    snapshot.pages.forEach((page) => {
      if (page?.path && !pageMap.has(page.path)) {
        pageMap.set(page.path, {
          path: page.path,
          label: formatPageLabel(page.path),
        });
      }
    });
  });

  const pages = Array.from(pageMap.values()).sort((left, right) => {
    if (left.path === '/') return -1;
    if (right.path === '/') return 1;
    return left.label.localeCompare(right.label, 'zh-Hans-CN');
  });

  return {
    siteUrl: history?.siteUrl || '',
    generatedAt: history?.generatedAt || '',
    pages,
    snapshots: normalizedSnapshots.sort((left, right) => left.date.localeCompare(right.date)),
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

function buildSeries(history, selectedRange, selectedPage) {
  const snapshots = history.snapshots;
  const boundedSnapshots = selectedRange === 'all' ? snapshots : snapshots.slice(-Number(selectedRange));

  const rows = boundedSnapshots.map((snapshot) => {
    const selectedPageStats = selectedPage === 'all'
      ? snapshot.site
      : snapshot.pages.find((page) => page.path === selectedPage) || { pv: 0, uv: 0 };

    return {
      date: snapshot.date,
      pv: Number(selectedPageStats.pv ?? 0),
      uv: Number(selectedPageStats.uv ?? 0),
    };
  });

  return rows;
}

function getPageLabel(history, selectedPage) {
  if (selectedPage === 'all') return '全站';
  return history.pages.find((page) => page.path === selectedPage)?.label || formatPageLabel(selectedPage);
}

function renderChart(rows, title, subtitle) {
  const labels = rows.map((row) => formatDateLabel(row.date));
  const pvValues = rows.map((row) => row.pv);
  const uvValues = rows.map((row) => row.uv);

  elements.chartTitle.textContent = title;
  elements.chartSubtitle.textContent = subtitle;

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

function updateSummary(rows, history, selectedRange, selectedPage) {
  const totalPv = rows.reduce((sum, row) => sum + row.pv, 0);
  const totalUv = rows.reduce((sum, row) => sum + row.uv, 0);
  const latest = rows[rows.length - 1] || { date: '--', pv: 0, uv: 0 };
  const peak = rows.reduce((best, current) => (current.pv > best.pv ? current : best), rows[0] || { date: '--', pv: 0, uv: 0 });
  const averageUv = rows.length ? Math.round(totalUv / rows.length) : 0;
  const rangeLabel = selectedRange === 'all' ? '全部历史' : `最近 ${selectedRange} 天`;
  const pageLabel = getPageLabel(history, selectedPage);

  elements.totalPv.textContent = formatNumber(totalPv);
  elements.totalUv.textContent = formatNumber(totalUv);
  elements.pvDelta.textContent = `${pageLabel} · ${rangeLabel}`;
  elements.uvDelta.textContent = `日均 UV ${formatNumber(averageUv)}，最新 ${latest.date}`;
  elements.peakDay.textContent = peak.date || '--';
  elements.peakValue.textContent = `峰值 PV ${formatNumber(peak.pv)}`;
  elements.dataSource.textContent = `${history.snapshots.length} 天`;
  elements.lastUpdated.textContent = history.generatedAt ? `最后更新：${history.generatedAt}` : '等待首个历史快照';
}

function populatePageSelect(history) {
  const options = [{ path: 'all', label: '全站' }, ...history.pages.filter((page) => page.path !== 'all')];
  elements.pageSelect.innerHTML = options
    .map(
      (page) => `
        <option value="${page.path}">${page.label}</option>
      `
    )
    .join('');

  if (!options.some((option) => option.path === appState.selectedPage)) {
    appState.selectedPage = 'all';
  }

  elements.pageSelect.value = appState.selectedPage;
}

function renderDashboard() {
  const { history, selectedRange, selectedPage } = appState;
  const rows = buildSeries(history, selectedRange, selectedPage);
  const pageLabel = getPageLabel(history, selectedPage);
  const rangeLabel = selectedRange === 'all' ? '全部历史' : `最近 ${selectedRange} 天`;

  renderChart(rows, `${pageLabel} · ${rangeLabel}`, '静态历史文件');
  renderTable(rows);
  updateSummary(rows, history, selectedRange, selectedPage);
}

async function loadHistory() {
  const payload = await fetchJson(HISTORY_URL);
  appState.history = normalizeHistory(payload);
  populatePageSelect(appState.history);
  renderDashboard();
}

async function refreshDashboard() {
  elements.refreshButton.disabled = true;
  elements.refreshButton.textContent = '加载中...';

  try {
    await loadHistory();
  } catch (error) {
    elements.statsTableBody.innerHTML = `<tr><td colspan="3" class="empty">${error instanceof Error ? error.message : String(error)}</td></tr>`;
    elements.totalPv.textContent = '--';
    elements.totalUv.textContent = '--';
    elements.pvDelta.textContent = '加载失败';
    elements.uvDelta.textContent = '加载失败';
    elements.peakDay.textContent = '--';
    elements.peakValue.textContent = '加载失败';
    elements.dataSource.textContent = '错误';
    elements.lastUpdated.textContent = '请检查静态历史文件是否可访问';
  } finally {
    elements.refreshButton.disabled = false;
    elements.refreshButton.textContent = '重新载入';
  }
}

elements.rangeSelect.addEventListener('change', (event) => {
  appState.selectedRange = event.target.value;
  renderDashboard();
});

elements.pageSelect.addEventListener('change', (event) => {
  appState.selectedPage = event.target.value;
  renderDashboard();
});

elements.refreshButton.addEventListener('click', refreshDashboard);

window.addEventListener('DOMContentLoaded', refreshDashboard);