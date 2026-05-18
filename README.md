# UVgraph

这是一个为 https://coperlm.github.io/ 做的 UV/PV 静态历史仪表盘。

## 在线入口

- 主入口：`/UV/`
- 根路径会自动跳转到 `/UV/`

## 当前结构

- `index.html`：根路径跳转页
- `UV/index.html`：仪表盘页面
- `UV/assets/styles.css`：页面样式
- `UV/assets/app.js`：拉取 Vercount 数据并渲染图表
- `UV/data/history.json`：每天追加的静态历史数据
- `scripts/update-history.mjs`：抓取 Vercount 并更新历史文件
- `.github/workflows/deploy-uv.yml`：静态发布工作流

## 数据来源

页面只读取本地静态历史文件 `UV/data/history.json`。

## GitHub Actions

工作流会做三件事：

1. 从 Vercount 和站点 sitemap 拉取当天数据
2. 追加写入 `UV/data/history.json`
3. 将静态站点发布到 `gh-pages` 分支

## 本地修改

如果你想改成别的网址，只需要修改 `UV/assets/app.js` 里的 `DEFAULT_TARGET`。

如果你想改变发布路径，请同步更新：

- `index.html`
- `UV/index.html`
- `.github/workflows/deploy-uv.yml`

## GitHub Pages

这个仓库现在使用 `gh-pages` 分支承载静态站点。如果你的仓库还没有启用 Pages，请在仓库设置里把 Pages source 指向 `gh-pages` 分支根目录。
