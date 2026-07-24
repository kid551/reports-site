# Implementation Notes

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
