import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseHTML } from "linkedom"
import type { PostMeta, SearchDoc } from "../src/lib/types"

const root = path.resolve(fileURLToPath(import.meta.url), "../..")
const POSTS_SRC = path.join(root, "posts")
const PUBLIC_POSTS = path.join(root, "public", "posts")
const GENERATED = path.join(root, ".generated")
const SEARCH_INDEX = path.join(root, "public", "search-index.json")
const POSTS_JSON = path.join(GENERATED, "posts.json")

const BASE = "/reports-site/"
const MAX_BODY_CHARS = 20_000

async function walk(dir: string, base = dir): Promise<string[]> {
  let entries: import("node:fs").Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch (e: any) {
    if (e.code === "ENOENT") return []
    throw e
  }
  const out: string[] = []
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      out.push(...(await walk(full, base)))
    } else if (e.isFile() && e.name.toLowerCase().endsWith(".html")) {
      out.push(path.relative(base, full))
    }
  }
  return out
}

function parseDateFromName(name: string): string | null {
  // 2026-05-22-foo.html | 2026-05-22.html
  const dashed = name.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (dashed) return `${dashed[1]}-${dashed[2]}-${dashed[3]}`
  // 20260522-foo.html
  const compact = name.match(/^(\d{4})(\d{2})(\d{2})/)
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`
  return null
}

// 完整发布时间戳（14 位 yyyymmddhhmmss），用于同一天内的精确倒序。
// 20260505-020039.html → 20260505020039；无 hhmmss 时补 000000；无日期返回 null。
function parseTimestampFromName(name: string): string | null {
  const withTime = name.match(/^(\d{4})-?(\d{2})-?(\d{2})[-_](\d{2})(\d{2})(\d{2})/)
  if (withTime) return withTime.slice(1).join("")
  const date = name.match(/^(\d{4})-?(\d{2})-?(\d{2})/)
  if (date) return date.slice(1).join("") + "000000"
  return null
}

function extractKeywords(content: string): string[] {
  return content
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim()
}

function injectBackButton(html: string): string {
  const button = `<a id="__back-to-list" href="${BASE}" aria-label="返回列表" style="position:fixed;top:12px;left:12px;z-index:2147483647;display:inline-flex;align-items:center;gap:6px;padding:6px 12px;background:rgba(15,23,42,.85);color:#fff;font:13px/1 ui-sans-serif,-apple-system,'PingFang SC',sans-serif;text-decoration:none;border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.15);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);">← 返回列表</a>`
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${button}\n</body>`)
  }
  // Fragment without <body>: wrap and append.
  return `${html}\n${button}`
}

async function processPost(rel: string): Promise<{ meta: PostMeta; doc: SearchDoc; sortKey: string }> {
  const srcPath = path.join(POSTS_SRC, rel)
  const raw = await fs.readFile(srcPath, "utf8")
  const stat = await fs.stat(srcPath)
  const { document } = parseHTML(raw)

  // strip scripts/styles from text extraction (but keep them in the saved HTML)
  const clone = document.cloneNode(true) as Document
  clone.querySelectorAll("script,style,noscript").forEach((n) => n.remove())

  const baseName = path.basename(rel, path.extname(rel))

  const titleEl = document.querySelector("title")
  const h1 = clone.querySelector("h1")
  const title = (titleEl?.textContent || h1?.textContent || baseName).trim()

  const descMeta = document
    .querySelector('meta[name="description"]')
    ?.getAttribute("content")
    ?.trim()
  const firstP = collapseWhitespace(clone.querySelector("p")?.textContent || "")
  // 手写的 meta description 完整保留、不截断；仅对自动提取的正文首段设 200 字预览上限
  const description = descMeta || firstP.slice(0, 200)

  const keywordsAttr = document.querySelector('meta[name="keywords"]')?.getAttribute("content")
  const keywords = keywordsAttr ? extractKeywords(keywordsAttr) : []

  const date = parseDateFromName(path.basename(rel)) || stat.mtime.toISOString().slice(0, 10)
  // 排序用完整时间戳；文件名无法解析时退回文件 mtime（14 位）。
  const sortKey =
    parseTimestampFromName(path.basename(rel)) ||
    stat.mtime.toISOString().replace(/\D/g, "").slice(0, 14)

  const id = rel.replace(/\\/g, "/")
  const href = `${BASE}posts/${id}`

  const meta: PostMeta = { id, href, title, description, date, keywords }
  const body = collapseWhitespace(clone.body?.textContent || "").slice(0, MAX_BODY_CHARS)

  // copy file with back button injection
  const destPath = path.join(PUBLIC_POSTS, rel)
  await fs.mkdir(path.dirname(destPath), { recursive: true })
  await fs.writeFile(destPath, injectBackButton(raw), "utf8")

  return { meta, doc: { ...meta, body }, sortKey }
}

async function rmRf(p: string) {
  await fs.rm(p, { recursive: true, force: true })
}

async function main() {
  await rmRf(PUBLIC_POSTS)
  await fs.mkdir(PUBLIC_POSTS, { recursive: true })
  await fs.mkdir(GENERATED, { recursive: true })

  const files = await walk(POSTS_SRC)
  const results = await Promise.all(files.map(processPost))

  // newest first，按文件名的完整 yyyymmddhhmmss 时间戳倒序
  results.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0))

  const posts = results.map((r) => r.meta)
  const docs = results.map((r) => r.doc)

  await fs.writeFile(POSTS_JSON, JSON.stringify(posts, null, 2), "utf8")
  await fs.writeFile(SEARCH_INDEX, JSON.stringify(docs), "utf8")

  const sizeKB = (JSON.stringify(docs).length / 1024).toFixed(1)
  console.log(`[build-posts] ${posts.length} post(s) processed; search index ${sizeKB} KB`)
}

main().catch((err) => {
  console.error("[build-posts] failed:", err)
  process.exit(1)
})
