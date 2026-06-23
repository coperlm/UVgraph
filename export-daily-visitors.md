# Vercount 每日文章访客导出文档

本文档说明如何从公开接口导出某个域名下「每天、每篇文章」的访问数据。

适用站点：`https://vercount-l2e8.vercel.app`

## 1. 功能说明

该接口用于导出指定域名在某个日期区间内的文章统计数据，返回格式为 CSV。

导出内容包含：

- 每篇文章的路径 `path`
- 每天的页面浏览量 `PV`
- 每天的独立访客数 `UV`

接口是公开的，不需要登录，不依赖 Cookie。

## 2. 接口地址

```text
GET https://vercount-l2e8.vercel.app/api/domains/export
```

## 3. 请求参数

### 必填参数

- `domain`

说明：要导出的域名。

示例：

```text
domain=example.com
```

### 可选参数

- `start`
- `end`

说明：导出的日期范围，格式为 `YYYY-MM-DD`。

示例：

```text
start=2026-05-01
end=2026-05-10
```

如果不传：

- `start` 默认是最近 30 天
- `end` 默认是今天

## 4. 完整请求示例

### 浏览器直接下载

```text
https://vercount-l2e8.vercel.app/api/domains/export?domain=example.com&start=2026-05-01&end=2026-05-10
```

### curl 下载

```bash
curl -G "https://vercount-l2e8.vercel.app/api/domains/export" \
  --data-urlencode "domain=example.com" \
  --data-urlencode "start=2026-05-01" \
  --data-urlencode "end=2026-05-10" \
  -o export-example.com.csv
```

## 5. 返回结果

接口会返回一个 CSV 文件下载响应，响应头通常包含：

- `Content-Type: text/csv; charset=utf-8`
- `Content-Disposition: attachment; filename="export-<domain>-<start>-<end>.csv"`

## 6. CSV 结构

CSV 第一列是页面路径，后面每两列对应一天的数据：

- `YYYY-MM-DD PV`
- `YYYY-MM-DD UV`

### 表头示例

```csv
path,2026-05-01 PV,2026-05-01 UV,2026-05-02 PV,2026-05-02 UV,2026-05-03 PV,2026-05-03 UV
```

### 数据示例

```csv
path,2026-05-01 PV,2026-05-01 UV,2026-05-02 PV,2026-05-02 UV
/,18,12,20,13
/post-1,9,7,11,8
/category/tech,6,5,7,5
```

## 7. 数据含义

### `path`

文章或页面路径，例如：

- `/`
- `/post-1`
- `/2026/05/my-article`

### `PV`

页面浏览量，表示当天该页面被访问的次数。

### `UV`

独立访客数，表示当天访问该页面的唯一访客数量。

## 8. 是否需要 Cookie 或登录

不需要。

当前导出接口是公开访问接口，不做 session 鉴权，也不依赖浏览器 Cookie。

这意味着：

- 你可以直接用浏览器打开下载
- 你可以在脚本、爬虫、自动化任务中直接调用
- 不会因为 Cookie 过期而失败

注意：如果你现在访问线上站点仍然返回 401，说明线上部署还不是最新代码。文档描述的是目标行为，真实线上结果以当前部署为准。

## 9. 导出范围说明

当前导出逻辑会：

1. 读取指定域名下的页面列表
2. 排除按天写入的 Redis key，避免把“日期 key”误认为页面路径
3. 按日期区间逐天导出每个页面的 PV/UV

也就是说，这个导出结果是“每天每篇文章”的明细表，不是只导出首页。

## 10. 常见问题

### 10.1 为什么我访问后返回 401？

如果你的部署不是最新代码，线上可能仍在使用旧版本。

请确认已重新部署最新代码，或者确认你访问的是最新 Vercel 部署。

### 10.2 为什么 CSV 里只有表头，没有数据？

常见原因：

- 这个域名下没有页面数据
- 数据尚未写入 Redis
- 域名参数写错了
- 查询的日期区间没有数据

### 10.3 为什么有些页面只有首页？

之前的版本会把按日统计 key 当成页面列表的一部分，导致列表污染。

现在已经修复：页面列表只保留真实的页面 key，不再把 `:YYYY-MM-DD` 结尾的 key 算进去。

### 10.4 路径为什么看起来像 `/` 或 `/post-1`？

导出的是网站内部存储的页面路径，不会自动拼接完整 URL。

如果你需要完整 URL，可以自行把域名和 path 拼接：

```text
https://example.com/post-1
```

### 10.5 导出很慢怎么办？

数据量大时，导出会随着：

- 页面数量增加
- 日期范围增加

而变慢。

建议：

- 缩短导出日期范围
- 分批导出
- 后续改成异步导出

## 11. 验证方法

### 11.1 浏览器验证

在浏览器中直接打开：

```text
https://vercount-l2e8.vercel.app/api/domains/export?domain=example.com&start=2026-05-01&end=2026-05-10
```

如果部署是最新版本，应该直接下载 CSV 文件。

### 11.2 命令行验证

```bash
curl -G "https://vercount-l2e8.vercel.app/api/domains/export" \
  --data-urlencode "domain=example.com" \
  --data-urlencode "start=2026-05-01" \
  --data-urlencode "end=2026-05-10" \
  -D - \
  -o export-example.com.csv
```

检查点：

- 状态码应为 `200`
- 响应头应包含 `Content-Disposition: attachment`
- 文件应为 CSV 内容

## 12. 本地测试说明

仓库内已提供一个本地 smoke test：

```bash
node scripts/test-export.js
```

该脚本使用 mock KV 验证导出逻辑，可以帮助你检查 CSV 结构是否正确。

### 12.1 成功运行结果

这是我本地跑通后得到的结果，说明 CSV 生成逻辑是正常的：

```text
Found paths: [ '/', '/post-1', '/category/tech' ]
path,2026-05-17 PV,2026-05-17 UV,2026-05-18 PV,2026-05-18 UV,2026-05-19 PV,2026-05-19 UV
/,11,16,89,7,45,14
/post-1,30,13,22,19,77,13
/category/tech,98,8,59,17,46,13
```

这表示：

- 页面列表能正确识别出 3 个页面
- 每个页面按天输出了 PV 和 UV
- CSV 格式可以直接下载和打开

### 12.2 线上测试结果

我对线上地址做过一次未鉴权请求，结果是 401：

```text
HTTP/2 401
```

这不是导出逻辑本身失败，而是说明线上部署还没有更新到公开接口版本，或者当前线上版本仍保留了鉴权逻辑。

## 13. 你可以直接复制的最小用法

如果你只想快速导出最近 10 天的数据：

```text
https://vercount-l2e8.vercel.app/api/domains/export?domain=example.com&start=2026-05-01&end=2026-05-10
```

如果你想用脚本批量下载：

```bash
curl -G "https://vercount-l2e8.vercel.app/api/domains/export" \
  --data-urlencode "domain=example.com" \
  --data-urlencode "start=2026-05-01" \
  --data-urlencode "end=2026-05-10" \
  -o export.csv
```

## 14. 后续可扩展项

如果你后面还想继续增强导出功能，可以考虑：

- 只导出 PV 或只导出 UV
- 导出为 XLSX
- 导出后自动压缩为 ZIP
- 增加“按文章总计”汇总行
- 增加后台异步导出任务
