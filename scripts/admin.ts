import { promises as fs } from "node:fs"
import path from "node:path"
import http from "node:http"
import { fileURLToPath } from "node:url"
import { parseHTML } from "linkedom"

const root = path.resolve(fileURLToPath(import.meta.url), "../..")
const POSTS_DIR = path.join(root, "posts")
const PORT = Number(process.env.PORT) || 4322
const HOST = "127.0.0.1"

interface Meta {
  title: string
  description: string
  date: string
  category: string
  keywords: string[]
}

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
    if (e.isDirectory()) out.push(...(await walk(full, base)))
    else if (e.isFile() && e.name.toLowerCase().endsWith(".html"))
      out.push(path.relative(base, full))
  }
  return out
}

function parseDateFromName(name: string): string | null {
  const dashed = name.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (dashed) return `${dashed[1]}-${dashed[2]}-${dashed[3]}`
  const compact = name.match(/^(\d{4})(\d{2})(\d{2})/)
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`
  return null
}

function slugFromFilename(filename: string): string {
  const base = path.basename(filename, path.extname(filename))
  return base.replace(/^\d{4}-?\d{2}-?\d{2}-?/, "") || "untitled"
}

async function readMeta(relPath: string): Promise<Meta> {
  const full = path.join(POSTS_DIR, relPath)
  const raw = await fs.readFile(full, "utf8")
  const stat = await fs.stat(full)
  const { document } = parseHTML(raw)

  const dir = path.dirname(relPath)
  const category = dir === "." ? "未分类" : dir.split(path.sep)[0]

  const title = (document.querySelector("title")?.textContent || "").trim()
  const description = (
    document.querySelector('meta[name="description"]')?.getAttribute("content") || ""
  ).trim()
  const keywordsAttr = (
    document.querySelector('meta[name="keywords"]')?.getAttribute("content") || ""
  ).trim()
  const keywords = keywordsAttr
    ? keywordsAttr
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean)
    : []

  const date =
    parseDateFromName(path.basename(relPath)) || stat.mtime.toISOString().slice(0, 10)

  return { title, description, date, category, keywords }
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")
}
function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function setTitle(html: string, value: string): string {
  if (/<title[^>]*>[\s\S]*?<\/title>/i.test(html)) {
    return html.replace(/<title[^>]*>[\s\S]*?<\/title>/i, `<title>${escapeText(value)}</title>`)
  }
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `  <title>${escapeText(value)}</title>\n</head>`)
  }
  return `<title>${escapeText(value)}</title>\n${html}`
}

function setMeta(html: string, name: string, value: string): string {
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

function removeMeta(html: string, name: string): string {
  const re = new RegExp(`\\s*<meta\\s+name=["']${name}["']\\s+content=["'][^"']*["']\\s*/?>`, "gi")
  return html.replace(re, "")
}

function changeFilename(relPath: string, newDate: string): string {
  const dir = path.dirname(relPath)
  const ext = path.extname(relPath)
  const baseName = path.basename(relPath, ext)
  const slug = baseName.replace(/^\d{4}-?\d{2}-?\d{2}-?/, "")
  const datePart = newDate.replace(/-/g, "-")
  const newName = slug ? `${datePart}-${slug}${ext}` : `${datePart}${ext}`
  return path.join(dir, newName)
}

function changeCategoryPath(relPath: string, newCategory: string): string {
  const file = path.basename(relPath)
  if (newCategory === "未分类" || !newCategory) return file
  return path.join(newCategory, file)
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function rmEmptyDirs(dir: string) {
  if (path.resolve(dir) === path.resolve(POSTS_DIR)) return
  try {
    const entries = await fs.readdir(dir)
    if (entries.length === 0) {
      await fs.rmdir(dir)
      await rmEmptyDirs(path.dirname(dir))
    }
  } catch {}
}

function safeRelInsidePosts(rel: string): string {
  const normalized = path.normalize(rel).replace(/^[/\\]+/, "")
  const abs = path.resolve(POSTS_DIR, normalized)
  if (!abs.startsWith(POSTS_DIR + path.sep) && abs !== POSTS_DIR) {
    throw new Error("Invalid path")
  }
  return path.relative(POSTS_DIR, abs)
}

function isAllowed(req: http.IncomingMessage): boolean {
  const host = req.headers.host || ""
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return false
  const origin = req.headers.origin
  if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return false
  return true
}

async function readJson(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const body = Buffer.concat(chunks).toString("utf8")
  if (!body) return null
  return JSON.parse(body)
}

function send(res: http.ServerResponse, code: number, body: string | Buffer, type = "text/plain") {
  res.statusCode = code
  res.setHeader("Content-Type", type)
  res.setHeader("Cache-Control", "no-store")
  res.end(body)
}
function sendJson(res: http.ServerResponse, code: number, obj: any) {
  send(res, code, JSON.stringify(obj), "application/json; charset=utf-8")
}

async function handlePosts(res: http.ServerResponse) {
  const files = await walk(POSTS_DIR)
  const list = await Promise.all(
    files.map(async (rel) => {
      const m = await readMeta(rel)
      return { id: rel.replace(/\\/g, "/"), slug: slugFromFilename(rel), ...m }
    }),
  )
  list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  sendJson(res, 200, list)
}

async function handleGetPost(res: http.ServerResponse, id: string) {
  const rel = safeRelInsidePosts(decodeURIComponent(id))
  const full = path.join(POSTS_DIR, rel)
  if (!(await pathExists(full))) return sendJson(res, 404, { error: "not found" })
  const meta = await readMeta(rel)
  sendJson(res, 200, { id: rel.replace(/\\/g, "/"), ...meta })
}

async function handlePutPost(res: http.ServerResponse, id: string, body: any) {
  const oldRel = safeRelInsidePosts(decodeURIComponent(id))
  const oldFull = path.join(POSTS_DIR, oldRel)
  if (!(await pathExists(oldFull))) return sendJson(res, 404, { error: "not found" })

  const title = String(body?.title ?? "").trim()
  const description = String(body?.description ?? "").trim()
  const dateRaw = String(body?.date ?? "").trim()
  const category = String(body?.category ?? "").trim() || "未分类"
  const keywordsArr: string[] = Array.isArray(body?.keywords)
    ? body.keywords.map((k: any) => String(k).trim()).filter(Boolean)
    : []

  if (dateRaw && !/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
    return sendJson(res, 400, { error: "date must be YYYY-MM-DD" })
  }

  // 1. rewrite HTML
  let html = await fs.readFile(oldFull, "utf8")
  if (title) html = setTitle(html, title)
  if (description) html = setMeta(html, "description", description)
  else html = removeMeta(html, "description")
  if (keywordsArr.length) html = setMeta(html, "keywords", keywordsArr.join(", "))
  else html = removeMeta(html, "keywords")

  // 2. compute new path
  let newRel = oldRel
  if (category) {
    const movedRel = changeCategoryPath(newRel, category)
    if (movedRel !== newRel) newRel = movedRel
  }
  if (dateRaw) {
    const oldDate = parseDateFromName(path.basename(newRel))
    if (oldDate !== dateRaw) newRel = changeFilename(newRel, dateRaw)
  }

  const newFull = path.join(POSTS_DIR, newRel)
  if (newRel !== oldRel && (await pathExists(newFull))) {
    return sendJson(res, 409, { error: `目标路径已存在: ${newRel}` })
  }

  // 3. write and move
  if (newRel === oldRel) {
    await fs.writeFile(oldFull, html, "utf8")
  } else {
    await fs.mkdir(path.dirname(newFull), { recursive: true })
    await fs.writeFile(newFull, html, "utf8")
    await fs.unlink(oldFull)
    await rmEmptyDirs(path.dirname(oldFull))
  }

  sendJson(res, 200, { id: newRel.replace(/\\/g, "/"), moved: newRel !== oldRel })
}

async function handleDeletePost(res: http.ServerResponse, id: string) {
  const rel = safeRelInsidePosts(decodeURIComponent(id))
  const full = path.join(POSTS_DIR, rel)
  if (!(await pathExists(full))) return sendJson(res, 404, { error: "not found" })
  await fs.unlink(full)
  await rmEmptyDirs(path.dirname(full))
  sendJson(res, 200, { ok: true })
}

function adminHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Admin · Reports</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.6 ui-sans-serif, -apple-system, "PingFang SC", "Hiragino Sans GB", sans-serif; color: #0f172a; background: #f8fafc; }
  .layout { display: grid; grid-template-columns: 320px 1fr; min-height: 100vh; }
  .sidebar { background: #fff; border-right: 1px solid #e2e8f0; overflow-y: auto; }
  .sidebar-header { padding: 16px 20px; border-bottom: 1px solid #e2e8f0; }
  .sidebar-header h1 { margin: 0; font-size: 16px; font-weight: 600; }
  .sidebar-header p { margin: 4px 0 0; font-size: 12px; color: #64748b; }
  .sidebar ul { list-style: none; padding: 0; margin: 0; }
  .sidebar li { padding: 12px 20px; border-bottom: 1px solid #f1f5f9; cursor: pointer; }
  .sidebar li:hover { background: #f8fafc; }
  .sidebar li.active { background: #eff6ff; border-left: 3px solid #2563eb; padding-left: 17px; }
  .sidebar .item-title { font-weight: 500; font-size: 13.5px; margin-bottom: 2px; }
  .sidebar .item-meta { font-size: 11px; color: #94a3b8; display: flex; gap: 8px; }
  .sidebar .item-meta .cat { background: #f1f5f9; padding: 1px 6px; border-radius: 999px; }
  main { padding: 32px 40px; max-width: 720px; }
  .empty { color: #94a3b8; text-align: center; margin-top: 80px; }
  .form-group { margin-bottom: 20px; }
  label { display: block; font-weight: 500; font-size: 13px; margin-bottom: 6px; color: #334155; }
  input, textarea { width: 100%; padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 6px; font: inherit; background: #fff; }
  input:focus, textarea:focus { outline: none; border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1); }
  textarea { resize: vertical; min-height: 80px; }
  .hint { font-size: 12px; color: #94a3b8; margin-top: 4px; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .actions { display: flex; gap: 12px; margin-top: 24px; padding-top: 20px; border-top: 1px solid #e2e8f0; }
  button { padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer; font: inherit; font-weight: 500; }
  .btn-primary { background: #0f172a; color: #fff; }
  .btn-primary:hover { background: #1e293b; }
  .btn-primary:disabled { background: #94a3b8; cursor: not-allowed; }
  .btn-ghost { background: transparent; color: #64748b; }
  .btn-ghost:hover { background: #f1f5f9; color: #0f172a; }
  .btn-danger { background: transparent; color: #dc2626; margin-left: auto; }
  .btn-danger:hover { background: #fef2f2; }
  .toast { position: fixed; top: 20px; right: 20px; padding: 10px 16px; border-radius: 6px; font-size: 13px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); z-index: 1000; }
  .toast.ok { background: #dcfce7; color: #166534; }
  .toast.err { background: #fee2e2; color: #991b1b; }
  .meta-line { font-size: 12px; color: #94a3b8; margin-bottom: 16px; font-family: ui-monospace, Menlo, monospace; }
  .meta-line a { color: #2563eb; text-decoration: none; }
</style>
</head>
<body>
<div class="layout">
  <aside class="sidebar">
    <div class="sidebar-header">
      <h1>Admin</h1>
      <p><span id="count">0</span> 篇文章 · 仅本机可访问</p>
    </div>
    <ul id="post-list"></ul>
  </aside>
  <main id="main">
    <div class="empty">从左侧选择一篇文章进行编辑</div>
  </main>
</div>
<div id="toast"></div>
<script>
const state = { posts: [], current: null }

const api = {
  list: () => fetch("/api/posts").then(r => r.json()),
  get: (id) => fetch("/api/posts/" + encodeURIComponent(id)).then(r => r.json()),
  put: (id, body) => fetch("/api/posts/" + encodeURIComponent(id), {
    method: "PUT", headers: {"Content-Type":"application/json"}, body: JSON.stringify(body)
  }).then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText); return j }),
  del: (id) => fetch("/api/posts/" + encodeURIComponent(id), { method: "DELETE" })
    .then(async r => { if (!r.ok) throw new Error((await r.json()).error || r.statusText) }),
}

function toast(msg, kind = "ok") {
  const t = document.createElement("div")
  t.className = "toast " + kind
  t.textContent = msg
  document.getElementById("toast").appendChild(t)
  setTimeout(() => t.remove(), 2400)
}

function escape(s) { return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[c])) }

async function renderList() {
  state.posts = await api.list()
  document.getElementById("count").textContent = state.posts.length
  const ul = document.getElementById("post-list")
  ul.innerHTML = state.posts.map(p => \`
    <li data-id="\${escape(p.id)}" \${state.current === p.id ? 'class="active"' : ''}>
      <div class="item-title">\${escape(p.title || p.id)}</div>
      <div class="item-meta"><span>\${escape(p.date)}</span><span class="cat">\${escape(p.category)}</span></div>
    </li>
  \`).join("")
  ul.querySelectorAll("li").forEach(li => {
    li.addEventListener("click", () => loadPost(li.dataset.id))
  })
}

async function loadPost(id) {
  state.current = id
  document.querySelectorAll("#post-list li").forEach(li => {
    li.classList.toggle("active", li.dataset.id === id)
  })
  const p = await api.get(id)
  if (p.error) return toast(p.error, "err")
  renderEditor(p)
}

function renderEditor(p) {
  const main = document.getElementById("main")
  main.innerHTML = \`
    <div class="meta-line">posts/\${escape(p.id)}  ·  <a href="/reports-site/posts/\${escape(p.id)}" target="_blank">预览原文 ↗</a></div>
    <div class="form-group">
      <label>标题 (title)</label>
      <input id="f-title" value="\${escape(p.title)}" />
    </div>
    <div class="form-group">
      <label>描述 (description)</label>
      <textarea id="f-description">\${escape(p.description)}</textarea>
      <div class="hint">空则不写入 meta；最长建议 200 字。</div>
    </div>
    <div class="row">
      <div class="form-group">
        <label>日期</label>
        <input id="f-date" type="date" value="\${escape(p.date)}" />
        <div class="hint">改动会重命名文件（YYYY-MM-DD-slug.html）。</div>
      </div>
      <div class="form-group">
        <label>分类</label>
        <input id="f-category" value="\${escape(p.category)}" list="cat-list" />
        <datalist id="cat-list">
          \${[...new Set(state.posts.map(x => x.category))].map(c => \`<option value="\${escape(c)}">\`).join("")}
        </datalist>
        <div class="hint">"未分类" = 放在 posts/ 根目录；其他 = 放进同名子目录。</div>
      </div>
    </div>
    <div class="form-group">
      <label>关键词 (keywords)</label>
      <input id="f-keywords" value="\${escape((p.keywords || []).join(", "))}" placeholder="逗号分隔" />
    </div>
    <div class="actions">
      <button class="btn-primary" id="btn-save">保存</button>
      <button class="btn-ghost" id="btn-reload">放弃改动</button>
      <button class="btn-danger" id="btn-delete">删除文章</button>
    </div>
  \`
  document.getElementById("btn-save").onclick = save
  document.getElementById("btn-reload").onclick = () => loadPost(state.current)
  document.getElementById("btn-delete").onclick = del
}

async function save() {
  const btn = document.getElementById("btn-save")
  btn.disabled = true; btn.textContent = "保存中..."
  try {
    const body = {
      title: document.getElementById("f-title").value,
      description: document.getElementById("f-description").value,
      date: document.getElementById("f-date").value,
      category: document.getElementById("f-category").value,
      keywords: document.getElementById("f-keywords").value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
    }
    const r = await api.put(state.current, body)
    state.current = r.id
    await renderList()
    await loadPost(r.id)
    toast(r.moved ? "已保存并重命名文件" : "已保存")
  } catch (e) {
    toast(e.message || "保存失败", "err")
  } finally {
    btn.disabled = false; btn.textContent = "保存"
  }
}

async function del() {
  if (!confirm("确定要删除这篇文章吗？此操作不可撤销。")) return
  try {
    await api.del(state.current)
    state.current = null
    await renderList()
    document.getElementById("main").innerHTML = '<div class="empty">从左侧选择一篇文章进行编辑</div>'
    toast("已删除")
  } catch (e) {
    toast(e.message || "删除失败", "err")
  }
}

renderList()
</script>
</body>
</html>`
}

const server = http.createServer(async (req, res) => {
  if (!isAllowed(req)) return send(res, 403, "Forbidden (host/origin check failed)")
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`)
    const p = url.pathname

    if (req.method === "GET" && p === "/") {
      return send(res, 200, adminHtml(), "text/html; charset=utf-8")
    }
    if (req.method === "GET" && p === "/api/posts") {
      return await handlePosts(res)
    }
    const m = p.match(/^\/api\/posts\/(.+)$/)
    if (m) {
      const id = m[1]
      if (req.method === "GET") return await handleGetPost(res, id)
      if (req.method === "PUT") return await handlePutPost(res, id, await readJson(req))
      if (req.method === "DELETE") return await handleDeletePost(res, id)
    }
    send(res, 404, "Not Found")
  } catch (e: any) {
    console.error("[admin]", e)
    sendJson(res, 500, { error: e.message || "internal error" })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`\n  ✓ Admin GUI running at http://${HOST}:${PORT}/\n`)
  console.log(`  · 仅监听 127.0.0.1，其他设备无法访问`)
  console.log(`  · 编辑后用 \`pnpm deploy\` 发布\n`)
})

process.on("SIGINT", () => {
  console.log("\n  Admin server stopped.")
  server.close()
  process.exit(0)
})
