import FlexSearch from "flexsearch"
import type { SearchDoc } from "./types"

declare global {
  interface Window {
    __BASE_URL: string
  }
}

type Doc = SearchDoc

let index: FlexSearch.Document<Doc, true> | null = null
let docsById: Map<string, Doc> = new Map()
let loading: Promise<void> | null = null

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function highlight(text: string, query: string): string {
  if (!query) return escapeHtml(text)
  const escaped = escapeHtml(text)
  const terms = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  if (!terms.length) return escaped
  const re = new RegExp(`(${terms.join("|")})`, "gi")
  return escaped.replace(re, "<mark>$1</mark>")
}

function snippet(body: string, query: string, radius = 80): string {
  if (!body) return ""
  const terms = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!terms.length) return body.slice(0, radius * 2)
  const lower = body.toLowerCase()
  let pos = -1
  for (const t of terms) {
    const i = lower.indexOf(t.toLowerCase())
    if (i >= 0) {
      pos = i
      break
    }
  }
  if (pos < 0) return body.slice(0, radius * 2)
  const start = Math.max(0, pos - radius)
  const end = Math.min(body.length, pos + radius * 2)
  const prefix = start > 0 ? "…" : ""
  const suffix = end < body.length ? "…" : ""
  return prefix + body.slice(start, end) + suffix
}

async function loadIndex(): Promise<void> {
  if (index) return
  if (loading) return loading
  loading = (async () => {
    const base = window.__BASE_URL || "/"
    const url = `${base.replace(/\/+$/, "/")}search-index.json`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Failed to load search index: ${res.status}`)
    const docs = (await res.json()) as Doc[]
    const idx = new FlexSearch.Document<Doc, true>({
      tokenize: "forward",
      cache: 100,
      document: {
        id: "id",
        index: [
          { field: "title", tokenize: "forward" },
          { field: "description", tokenize: "forward" },
          { field: "keywords", tokenize: "forward" },
          { field: "body", tokenize: "forward" },
        ],
        store: true,
      },
    })
    for (const d of docs) {
      idx.add(d)
      docsById.set(d.id, d)
    }
    index = idx
  })()
  return loading
}

function search(query: string, limit = 30): Doc[] {
  if (!index) return []
  // limit 必须作为独立参数传，才能命中 FlexSearch 那个按 Enrich 推导返回类型的重载；
  // 塞进 options 里会落到返回 SimpleDocumentSearchResultSetUnit[] 的重载上。
  const raw = index.search<true>(query, limit, { enrich: true, suggest: true })
  const seen = new Set<string>()
  const out: Doc[] = []
  for (const group of raw) {
    for (const r of group.result) {
      const id = String(r.id)
      if (seen.has(id)) continue
      seen.add(id)
      out.push(r.doc)
      if (out.length >= limit) return out
    }
  }
  return out
}

function renderResults(results: Doc[], query: string): string {
  if (!results.length) {
    return `<div class="empty">未找到与「${escapeHtml(query)}」匹配的内容</div>`
  }
  return `<ul class="post-list">${results
    .map((p) => {
      const desc = p.description || snippet(p.body, query)
      return `<li class="post-item">
        <a href="${escapeHtml(p.href)}" class="post-card">
          <h3 class="post-title">${highlight(p.title, query)}</h3>
          ${desc ? `<p class="post-desc">${highlight(desc, query)}</p>` : ""}
          <div class="post-meta">
            <time>${escapeHtml(p.date)}</time>
            ${
              p.keywords.length
                ? `<span class="tags">${p.keywords
                    .map((k) => `<span class="cat">${escapeHtml(k)}</span>`)
                    .join("")}</span>`
                : ""
            }
          </div>
        </a>
      </li>`
    })
    .join("")}</ul>`
}

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let t: ReturnType<typeof setTimeout> | null = null
  return ((...args: any[]) => {
    if (t) clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }) as T
}

export function initSearch() {
  const input = document.getElementById("search-input") as HTMLInputElement | null
  const status = document.getElementById("search-status")
  const listDefault = document.getElementById("list-default")
  const listSearch = document.getElementById("list-search")
  const tagNav = document.getElementById("tag-nav")
  if (!input || !listDefault || !listSearch) return

  const setStatus = (msg: string) => {
    if (status) status.textContent = msg
  }

  const runSearch = debounce(async (q: string) => {
    const query = q.trim()
    if (!query) {
      listSearch.hidden = true
      listDefault.hidden = false
      setStatus("")
      return
    }
    try {
      setStatus("加载索引……")
      await loadIndex()
      const results = search(query)
      listSearch.innerHTML = renderResults(results, query)
      listSearch.hidden = false
      listDefault.hidden = true
      setStatus(`找到 ${results.length} 条结果`)
    } catch (e) {
      console.error(e)
      setStatus("搜索失败，请刷新重试")
    }
  }, 120)

  input.addEventListener("input", () => runSearch(input.value))
  input.addEventListener("focus", () => {
    if (!index) loadIndex().catch(() => {})
  })

  if (tagNav) {
    tagNav.addEventListener("click", (e) => {
      const t = e.target as HTMLElement
      const btn = t.closest("button[data-tag]") as HTMLButtonElement | null
      if (!btn) return
      const tag = btn.dataset.tag || "__all"
      tagNav.querySelectorAll<HTMLButtonElement>("button[data-tag]").forEach((el) => {
        el.classList.toggle("active", el === btn)
      })
      listDefault.querySelectorAll<HTMLLIElement>("li[data-tags]").forEach((li) => {
        // data-tags 形如 |芯片|半导体|，用分隔符包裹以避免子串误匹配
        const match = (li.dataset.tags || "").includes(`|${tag}|`)
        li.style.display = tag === "__all" || match ? "" : "none"
      })
      listDefault.querySelectorAll<HTMLDivElement>("div[data-month]").forEach((div) => {
        const visible = Array.from(div.querySelectorAll<HTMLLIElement>("li[data-tags]")).some(
          (li) => li.style.display !== "none",
        )
        div.style.display = visible ? "" : "none"
      })
    })
  }
}
