# UVgraph

这是一个为 https://coperlm.github.io/ 做的 UV/PV 折线图仪表盘。

## 在线入口

- 主入口：`/UV/`
- 根路径会自动跳转到 `/UV/`

## 当前结构

- `index.html`：根路径跳转页
- `UV/index.html`：仪表盘页面
- `UV/assets/styles.css`：页面样式
- `UV/assets/app.js`：拉取 Vercount 数据并渲染图表
- `UV/data/cache.json`：GitHub Actions 生成的同源缓存
- `.github/workflows/deploy-uv.yml`：GitHub Pages 部署工作流

## 数据来源

页面默认读取 Vercount 时序接口：

- `https://vercount-l2e8.vercel.app/api/v2/stats?url=https://coperlm.github.io/&type=both`

如果实时接口不可用，页面会回退到同源缓存 `UV/data/cache.json`。

## GitHub Actions

工作流会做两件事：

1. 拉取最新的 Vercount 时序数据，写入 `UV/data/cache.json`
2. 将整个站点作为 GitHub Pages artifact 发布

## 本地修改

如果你想改成别的网址，只需要修改 `UV/assets/app.js` 里的 `DEFAULT_TARGET`。

如果你想改变发布路径，请同步更新：

- `index.html`
- `UV/index.html`
- `.github/workflows/deploy-uv.yml`
