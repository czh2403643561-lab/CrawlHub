# CrawlHub 项目交接

## 先看这里

这是一个纯 Chrome/Edge 浏览器数据采集扩展，不是商品情报中心，也不包含 AI 分析、供应链、商品展示面板。

当前本地分支：`main`，最新稳定代码：`e4ea411 fix: show export save location`；本地已与 GitHub `origin/main` 同步。

稳定基线标签：`stable-2026-09-15`。最新稳定包：[dist/CrawlHub_稳定版_0.1.0.zip](dist/CrawlHub_稳定版_0.1.0.zip)。稳定标签和稳定包用于继续开发时的安全恢复，不会因后续新功能修改而变化。

## 项目用途

- 分析网页 DOM、表格和列表结构，生成本地 `analysis.json` 报告。
- 采集当前页，支持用户手动翻页后的累计采集。
- 保存本地采集任务和字段模板。
- 导出 JSON、CSV、XLSX 项目文件。
- 适配 TikTok 商品热卖榜：总榜、直播榜、短视频榜、商品卡、达人榜、新品榜。

数据仅在本地处理；不上传 Cookie、账号信息或页面响应内容；不自动登录、不自动翻页、不点击视频、不获取视频播放地址。

## 运行与发布

- 扩展入口：`manifest.json`，Manifest V3。
- 开发运行：Chrome/Edge 扩展页面开启开发者模式，选择“加载已解压的扩展程序”，指向项目根目录。
- 可分享发布包：[dist/CrawlHub_稳定版_0.1.0.zip](dist/CrawlHub_稳定版_0.1.0.zip)。解压后直接选择含 `manifest.json` 的目录。
- 小白指南：[CrawlHub_电脑小白上手指南.md](CrawlHub_电脑小白上手指南.md)。

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `manifest.json` | 扩展权限、content script、service worker、popup 配置。 |
| `popup.html` / `popup.js` / `popup.css` | 工具栏按钮打开当前页面的悬浮面板。 |
| `content.js` | 页面与扩展 service worker 的本地存储通信桥。 |
| `service-worker.js` | 使用 `chrome.storage.local` 保存和读取本地项目。 |
| `analyzer.js` | 核心：页面分析、元素采样、字段模板、采集、任务状态、导出和悬浮面板。 |
| `PROJECT_STATUS.md` | 当前成果、限制与下一步。 |

## 核心代码入口

所有核心逻辑都在 `analyzer.js`：

- `collectPageData()`：根据表头与行列关系生成字段模板并采集当前表格。
- `collectCurrentPage()`：按“类目 + 榜单类型”隔离任务，追加人工翻页后的数据。
- `collectionProjectData()`：把原始记录标准化为项目数据结构。
- `exportCollectionProject()`：导出 `metadata.json`、`products.json`、`products.csv`、`products.xlsx`。
- `startElementSampling()` / `pauseElementSampling()`：元素采样状态机；暂停后允许滚动页面。
- `installPanel()`：悬浮面板和按钮事件。

## 数据结构

项目数据：

```json
{
  "metadata": {
    "category_full": "",
    "category_short": "",
    "page_title": "",
    "url": "",
    "created_at": "",
    "rank_type": ""
  },
  "products": []
}
```

常用商品字段：

```text
rank, rank_change, product_name, image, price, rating, review_count,
gmv, clicks, ctr, live_account, best_video, creator, shop,
similar_products, videos, related_content
```

短视频榜的 `videos` 为：

```json
[
  {
    "cover": "页面已展示的视频封面地址",
    "creator": null
  }
]
```

短视频视频卡片通过表头“表现最佳的视频”与 `VideoPlayBtn` 图片结构识别；没有封面的卡片跳过。`creator` 只在当前 DOM 已经有对应文本时才可能有值，不能主动触发悬浮层或点击视频。

## 已完成的关键兼容点

- 排名和排名变化拆分：趋势数值不会误写入 `rank`。
- 短表头“商品”不会误匹配“同款商品数”。
- 六榜字段按表头映射，不依赖固定列位置。
- 类目 metadata 自动提取：优先 `.rank-arco-tag-content`，失败时使用“未识别”但不阻止导出。
- 扩展重载后支持重新连接页面；字段模板、任务状态、保存目录不应主动清除。
- 任务按“类目 + 榜单类型”隔离；切换榜单会保留旧任务。
- 导出目录结构为“导出根目录 / 类目 / 榜单”。
- CSV/XLSX 中的嵌套对象以 JSON 字符串写出，避免 `[object Object]`。

## 已知限制与真实验证缺口

1. 当前没有可用的已登录 TikTok Seller Center 页面，所以尚未完成六个榜单的逐一真实采集和导出回归。
2. 现有采样报告确认了短视频封面和达人头像结构，但没有稳定提供视频播放地址、达人主页 href 或每张视频卡片的达人名称。
3. 短视频榜只采集当前已展示的封面；不点击、不播放、不下载。
4. 外部采样文件在用户桌面，不在仓库。需要时请向用户索取或读取这些路径：

```text
C:\Users\Atlas\Desktop\采样\总榜\总榜.json
C:\Users\Atlas\Desktop\采样\直播榜\直播榜单.json
C:\Users\Atlas\Desktop\采样\短视频榜\短视频榜.json
C:\Users\Atlas\Desktop\采样\商品卡榜\商品卡榜.json
C:\Users\Atlas\Desktop\采样\达人榜\达人榜.json
C:\Users\Atlas\Desktop\采样\新品榜\新品榜.json
C:\Users\Atlas\Desktop\单独达人和短视频2analysis.json
C:\Users\Atlas\Desktop\单独达人和短视频analysis.json
```

## 建议的新对话第一步

先读取：

1. `PROJECT_STATUS.md`
2. `AGENTS.md`
3. 本文件 `HANDOFF.md`
4. `git status --short --branch` 与 `git log -3 --oneline`

之后只按任务读取相关代码，不扫描整个项目。

如果用户要继续 TikTok 榜单验证，建议让用户在已登录页面依次执行：

```text
总榜采集 → 直播榜创建新任务 → 返回总榜继续采集 → 导出项目
短视频榜采集 → 检查 products.json 内 products[n].videos
扩展重新加载 → 重新连接页面 → 检查任务和模板恢复
```

## 不要做的事

- 不恢复或新增商品情报中心、工作台、AI 分析、找货源、收藏 UI。
- 不改变通用商品字段和已跑通的采集算法，除非有明确回归证据。
- 不点击视频、打开播放器、获取播放 URL、下载视频或模拟观看。
- 不使用 `git reset --hard`、强推或回退 Git 历史。
- 完成独立小任务后：更新 `PROJECT_STATUS.md`，只提交本任务文件，并推送到 `origin/main`。
