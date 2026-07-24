/**
 * 读写文章 HTML 里 <head> 元信息的共享工具。
 * 被 scripts/admin.ts（管理后台）和 scripts/dev-tags.ts（dev 内联标签编辑）共用，
 * 避免同一套正则实现两遍后逐渐走样。
 */
import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const ROOT = path.resolve(fileURLToPath(import.meta.url), "../..")
export const POSTS_DIR = path.join(ROOT, "posts")

/** "芯片, 半导体" -> ["芯片", "半导体"]；中英文逗号都认 */
export function parseKeywords(content: string): string[] {
  return content
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")
}

export function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

export function setTitle(html: string, value: string): string {
  if (/<title[^>]*>[\s\S]*?<\/title>/i.test(html)) {
    return html.replace(/<title[^>]*>[\s\S]*?<\/title>/i, `<title>${escapeText(value)}</title>`)
  }
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `  <title>${escapeText(value)}</title>\n</head>`)
  }
  return `<title>${escapeText(value)}</title>\n${html}`
}

export function setMeta(html: string, name: string, value: string): string {
  const reDouble = new RegExp(`<meta\\s+name=["']${name}["']\\s+content=["'][^"']*["']\\s*/?>`, "i")
  const reReversed = new RegExp(
    `<meta\\s+content=["'][^"']*["']\\s+name=["']${name}["']\\s*/?>`,
    "i",
  )
  const replacement = `<meta name="${name}" content="${escapeAttr(value)}">`
  if (reDouble.test(html)) return html.replace(reDouble, replacement)
  if (reReversed.test(html)) return html.replace(reReversed, replacement)

  if (!value) return html // don't insert empty
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `  ${replacement}\n</head>`)
  }
  return `${replacement}\n${html}`
}

export function removeMeta(html: string, name: string): string {
  const re = new RegExp(`\\s*<meta\\s+name=["']${name}["']\\s+content=["'][^"']*["']\\s*/?>`, "gi")
  return html.replace(re, "")
}

/** 写入 keywords；空数组表示删掉整个 meta 标签而不是留一个空 content */
export function setKeywords(html: string, keywords: string[]): string {
  return keywords.length
    ? setMeta(html, "keywords", keywords.join(", "))
    : removeMeta(html, "keywords")
}

/** 写入 description（摘要）；空串表示删掉整个 meta 标签而不是留空 content */
export function setDescription(html: string, value: string): string {
  return value ? setMeta(html, "description", value) : removeMeta(html, "description")
}

/** 防路径穿越：确保 rel 解析后仍落在 posts/ 内 */
export function safeRelInsidePosts(rel: string): string {
  const normalized = path.normalize(rel).replace(/^[/\\]+/, "")
  const abs = path.resolve(POSTS_DIR, normalized)
  if (!abs.startsWith(POSTS_DIR + path.sep) && abs !== POSTS_DIR) {
    throw new Error("Invalid path")
  }
  return path.relative(POSTS_DIR, abs)
}

/**
 * 删文件后向上回收空目录，止步于 stopAt（默认 posts/）。
 * dir 必须严格位于 stopAt 之内，否则直接返回——避免递归越界删到项目根。
 */
export async function rmEmptyDirs(dir: string, stopAt: string = POSTS_DIR) {
  const abs = path.resolve(dir)
  const root = path.resolve(stopAt)
  if (abs === root || !abs.startsWith(root + path.sep)) return
  try {
    const entries = await fs.readdir(abs)
    if (entries.length === 0) {
      await fs.rmdir(abs)
      await rmEmptyDirs(path.dirname(abs), stopAt)
    }
  } catch {}
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}
