# Implementation Notes

## 2026-08-25 · 目录在列表页折叠展示

### 背景

`posts/` 下开始出现子目录（`20260825-114658-buffett-annual-meetings-transcripts/`，33 个 HTML）。
`build-posts.ts` 的 `walk()` 本来就递归，所以这 33 篇被平铺进首页列表，直接淹没了同月的其他文章。
需要的是「目录 = 一组」的层级展示，而不是把目录当成 URL 前缀。

### 做了什么

1. `src/components/PostCard.astro` — 把原来写在 index.astro 里的卡片 markup 抽出来，
   顶层卡片和目录内的子卡片共用同一份（`li.post-item` + `data-id` + `data-tags` 不变，
   card-editor 和标签筛选照常工作）。
2. `src/pages/index.astro` — 遍历 posts.json 组装 `Entry[]`：`id` 不含 `/` 的是普通文章，
   含 `/` 的按**第一层目录**归组。组的日期取组内最新一篇，决定落在哪个月份分组下。
   目录里的 `index.html` 当封面：标题挂到组头、右侧给一个「目录页 →」链接，不再单独占一张卡。
   渲染成 `<details class="folder">`（**默认收起**）+ 缩进的子列表。
3. `src/lib/search-client.ts` — 标签筛选补一段：目录组自己没有 `data-tags`，
   按「组内是否还有可见子文章」决定显隐；筛选态下自动 `open`，好让命中的子文章露出来，切回「全部」再收起。
4. `src/lib/card-editor.ts` — dev 删文章时同步维护组头的「N 篇」计数，删空了把整组收掉。
5. `src/styles/global.css` — `.folder-*` 一组样式，子列表左侧一根竖线表达层级；移动端缩进收窄。

搜索结果不受影响，仍是平铺（搜索本来就该跨目录）。

### 偏差

- **只按第一层目录分组**。`a/b/c.html` 会平铺进 `a` 这一组，不再往下嵌套。
  当前只有一层目录，递归树要额外处理「嵌套组落在哪个月份」，收益为负，不做。
- **目录组头的日期取组内最新一篇**。组内文章跨月时，整组只出现在最新那个月份下，
  旧月份不会重复出现这个目录。个人站点，可接受。
- **没有 `index.html` 的目录**，组头标题退回目录名（去掉 `yyyymmdd-hhmmss-` 前缀），不带「目录页」链接。

## 2026-07-24 · dev 内联编辑文章摘要

### 背景

首页卡片上的摘要来自 `PostMeta.description`——[build-posts.ts](scripts/build-posts.ts) 里
取 `<meta name="description">`，没有就退回正文首个 `<p>`，再 `.slice(0, 200)`。
此前只能改标签、删文章，摘要只能去源 HTML 手改。现补上 dev-only 的内联编辑，
沿用既有 `PUT /__tags` 那套模式。

### 做了什么

1. `scripts/post-meta.ts` — 新增 `setDescription()`（镜像 `setKeywords`，空串则删掉整个 meta 标签）。
2. `scripts/dev-api.ts` — 新增 `PUT /__summary { id, description }`；把 `patchRecord` 泛化成
   合并任意字段（原来写死 keywords）。写 `<meta name="description">` + 增量 patch 两份 JSON 索引，
   同 `/__tags` 一样不整体重跑 build-posts。**不限字数**（手写摘要不截断）。
3. `src/lib/card-editor.ts` — 点击 `.post-desc` 就地展开 textarea：
   **Enter 换行、⌘/Ctrl+Enter 保存、Esc 取消**，另配 保存/取消 按钮，编辑不限字数。
   没有摘要的卡片补一个 `.post-desc.desc-empty`「＋ 添加摘要」占位，让用户能新增。
   编辑框整体 `stopPropagation`，因此点进文本框不会冒泡到 `<a>` 触发跳转。
4. `src/styles/global.css` — 摘要编辑相关样式；`.post-desc` 用 `white-space: pre-line`
   完整显示多行摘要，去掉了原来的 `-webkit-line-clamp:1` 单行截断。
5. `scripts/build-posts.ts` — 手写的 meta description 完整保留不截断；
   仅对「无 meta 时自动提取的正文首段」保留 200 字预览上限。

### 偏差

- **清空摘要在 dev 与 rebuild 之间不一致**。用户清空摘要 → `removeMeta` 删掉 meta、JSON 记为 `""`，
  dev 卡片立即空。但下次整体 `build-posts` 时 `description` 会重新退回正文首个 `<p>`——
  因为 description 的来源本就是「meta 优先，否则首 `<p>`」。即「清空」在 dev 是即时生效的，
  但不等于永久压制首段摘要。个人站点、可接受，未做特殊处理。
- **摘要允许换行且完整显示**（用户明确要求 Enter=换行、多行完整展示、编辑不限字数）。
  meta content 里存字面换行符，卡片用 `white-space: pre-line` 原样渲染多行；未做 whitespace 折叠。
  代价：摘要越长卡片越高，同一月份分组下卡片高度会参差——个人站点、用户要的就是完整，接受。

## 2026-07-24 · 废除目录分类，统一到标签

### 背景

首页早已改为按 `<meta name="keywords">` 标签筛选（[index.astro](src/pages/index.astro) 只读 `p.keywords`），
但 `posts/投研/` 这个目录还在，`category` 字段仍从目录名推导。结果是两套并行的分类机制，
其中一套（目录）在前端完全不可见，只有 `pnpm admin` 后台还在展示和编辑它。

### 做了什么

1. **先补标签，再平移**。`posts/投研/` 下 14 篇里有 7 篇完全没有 keywords，
   目录名是它们唯一的分类信息。直接平移会让它们掉进「未分类」，属于净损失。
   所以先给 14 篇统统 prepend `投研` 标签（已有标签的追加而非覆盖），再 `git mv` 到 `posts/` 根目录。
2. **删掉 `category` 概念**：
   - `src/lib/types.ts` — `PostMeta.category` 字段
   - `scripts/build-posts.ts` — 从目录名推导 category 的逻辑
   - `scripts/admin.ts` — `changeCategoryPath()`、分类输入框、改分类时的移动文件逻辑
   - `scripts/new.ts` — `--category` / `-c` 参数
3. admin 后台的分类输入框换成标签输入框，datalist 从全站已有标签聚合。

### 偏差

- **`build-posts.ts` 的 `walk()` 仍然递归扫子目录**，没有改成只扫一层。
  子目录现在不产生任何分类语义，但递归是既有行为且无害——真放了子目录也只是 URL 变长。
  保守起见不动。
- **`global.css` 里的 `.cat` / `.cat-nav` / `.cat-chip` 类名没有重命名**。
  这些是 category 时代留下的命名，但现在实际服务于标签 UI 且工作正常。
  纯粹的改名churn，不在本次改动范围内。
- **旧 URL 不做重定向**。`/posts/投研/xxx.html` → `/posts/xxx.html`，已分享的链接会 404。
  个人站点，用户明确表示不在意。

### 教训：并发写冲突

改动过程中 dev server 的内联标签编辑器（[dev-api.ts](scripts/dev-api.ts) 的 `PUT /__tags`）
和批量脚本同时写 `posts/`，导致用户的一次编辑被 `git checkout` 回滚掉。

**规则：批量改 `posts/` 之前，先确认 dev server 已停。**
`dev-api.ts` 的写入面只有「改 keywords」和「删文章」两种，
所以这类冲突的影响范围是可界定、可恢复的——但别再来一次。
