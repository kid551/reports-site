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
  return escaped.replace(re, "<mark class=\"bg-yellow-200 rounded px-0.5\">$1</mark>")
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
  const raw = index.search(query, { limit, enrich: true, suggest: true })
  const seen = new Set<string>()
  const out: Doc[] = []
  for (const group of raw) {
    for (const r of group.result as Array<{ id: string; doc: Doc }>) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      out.push(r.doc)
      if (out.length >= limit) return out
    }
  }
  return out
}

function renderResults(results: Doc[], query: string): string {
  if (!results.length) {
    return `<div class="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">未找到与「${escapeHtml(
      query,
    )}」匹配的内容</div>`
  }
  return `<ul class="space-y-2">${results
    .map((p) => {
      const desc = p.description || snippet(p.body, query)
      return `<li>
        <a href="${escapeHtml(p.href)}" class="block rounded-lg border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:shadow-sm">
          <div class="flex items-baseline justify-between gap-3">
            <h3 class="font-medium text-slate-900">${highlight(p.title, query)}</h3>
            <time class="shrink-0 text-xs text-slate-400">${escapeHtml(p.date)}</time>
          </div>
          ${
            desc
              ? `<p class="mt-1 line-clamp-3 text-sm text-slate-500">${highlight(desc, query)}</p>`
              : ""
          }
          <div class="mt-2 flex items-center gap-2 text-xs text-slate-400">
            <span class="rounded bg-slate-100 px-1.5 py-0.5">${escapeHtml(p.category)}</span>
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
  const catNav = document.getElementById("category-nav")
  if (!input || !listDefault || !listSearch) return

  const setStatus = (msg: string) => {
    if (status) status.textContent = msg
  }

  const runSearch = debounce(async (q: string) => {
    const query = q.trim()
    if (!query) {
      listSearch.classList.add("hidden")
      listDefault.classList.remove("hidden")
      setStatus("")
      return
    }
    try {
      setStatus("加载索引...")
      await loadIndex()
      const results = search(query)
      listSearch.innerHTML = renderResults(results, query)
      listSearch.classList.remove("hidden")
      listDefault.classList.add("hidden")
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

  if (catNav) {
    catNav.addEventListener("click", (e) => {
      const t = e.target as HTMLElement
      const btn = t.closest("button[data-cat]") as HTMLButtonElement | null
      if (!btn) return
      const cat = btn.dataset.cat || "__all"
      catNav.querySelectorAll("button[data-cat]").forEach((b) => {
        const el = b as HTMLButtonElement
        if (el === btn) {
          el.classList.remove("bg-slate-100", "text-slate-700", "hover:bg-slate-200")
          el.classList.add("bg-slate-900", "text-white")
        } else {
          el.classList.add("bg-slate-100", "text-slate-700", "hover:bg-slate-200")
          el.classList.remove("bg-slate-900", "text-white")
        }
      })
      listDefault.querySelectorAll<HTMLLIElement>("li[data-category]").forEach((li) => {
        li.style.display = cat === "__all" || li.dataset.category === cat ? "" : "none"
      })
      listDefault.querySelectorAll<HTMLDivElement>("div[data-month]").forEach((div) => {
        const visible = Array.from(div.querySelectorAll<HTMLLIElement>("li[data-category]")).some(
          (li) => li.style.display !== "none",
        )
        div.style.display = visible ? "" : "none"
      })
    })
  }
}
