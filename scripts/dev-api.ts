/**
 * dev-only 的文章编辑接口。
 *
 * 挂成 Vite plugin 的 `apply: "serve"`，因此只在 `pnpm dev` 时存在；
 * `astro build` 的产物里不含任何服务端代码，线上永远拿不到这些接口。
 *
 * PUT    /__tags  { id, keywords: string[] }  改写 <meta name="keywords">
 * DELETE /__post  { id }                      删除整篇文章
 *
 * 两者都只增量更新 .generated/posts.json 与 public/search-index.json 中的对应记录，
 * 不整体重跑 build-posts —— 那会 rm -rf public/posts，触发 dev server 整页刷新。
 */
import { promises as fs } from "node:fs"
import path from "node:path"
import type { IncomingMessage, ServerResponse } from "node:http"
import {
  POSTS_DIR,
  ROOT,
  pathExists,
  rmEmptyDirs,
  safeRelInsidePosts,
  setKeywords,
} from "./post-meta.ts"

const GENERATED_POSTS = path.join(ROOT, ".generated", "posts.json")
const SEARCH_INDEX = path.join(ROOT, "public", "search-index.json")
const PUBLIC_POSTS = path.join(ROOT, "public", "posts")

/** 只接受本机请求，和 admin.ts 的策略保持一致 */
function isLocal(req: IncomingMessage): boolean {
  const host = req.headers.host || ""
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) return false
  const origin = req.headers.origin
  if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin)) return false
  return true
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const raw = Buffer.concat(chunks).toString("utf8")
  return raw ? JSON.parse(raw) : null
}

function sendJson(res: ServerResponse, code: number, obj: unknown) {
  res.statusCode = code
  res.setHeader("Content-Type", "application/json; charset=utf-8")
  res.setHeader("Cache-Control", "no-store")
  res.end(JSON.stringify(obj))
}

/** 就地更新 JSON 数组里 id 匹配的那条记录的 keywords */
async function patchRecord(file: string, id: string, keywords: string[]) {
  if (!(await pathExists(file))) return
  const list = JSON.parse(await fs.readFile(file, "utf8")) as Array<{
    id: string
    keywords: string[]
  }>
  const hit = list.find((r) => r.id === id)
  if (!hit) return
  hit.keywords = keywords
  // posts.json 原本就是缩进写出的，search-index 是压缩的，各自保持
  const pretty = file === GENERATED_POSTS
  await fs.writeFile(file, JSON.stringify(list, null, pretty ? 2 : undefined), "utf8")
}

/** 从 JSON 数组里移除 id 匹配的那条记录 */
async function dropRecord(file: string, id: string) {
  if (!(await pathExists(file))) return
  const list = JSON.parse(await fs.readFile(file, "utf8")) as Array<{ id: string }>
  const next = list.filter((r) => r.id !== id)
  if (next.length === list.length) return
  const pretty = file === GENERATED_POSTS
  await fs.writeFile(file, JSON.stringify(next, null, pretty ? 2 : undefined), "utf8")
}

export function devApi() {
  return {
    name: "dev-api",
    apply: "serve" as const,
    configureServer(server: { middlewares: { use: (fn: any) => void } }) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = (req.url || "").split("?")[0]
        const isTags = url === "/__tags"
        const isPost = url === "/__post"
        if (!isTags && !isPost) return next()

        const expected = isTags ? "PUT" : "DELETE"
        if (req.method !== expected) return sendJson(res, 405, { error: "method not allowed" })
        if (!isLocal(req)) return sendJson(res, 403, { error: "local only" })

        try {
          const body = await readBody(req)
          const rel = safeRelInsidePosts(String(body?.id ?? ""))
          const full = path.join(POSTS_DIR, rel)
          if (!(await pathExists(full))) return sendJson(res, 404, { error: "not found" })
          const id = rel.replace(/\\/g, "/")

          if (isTags) {
            const keywords: string[] = Array.isArray(body?.keywords)
              ? Array.from(
                  new Set(
                    body.keywords
                      .map((k: unknown) => String(k).trim())
                      .filter((k: string) => k && !k.includes("|") && !/[,，]/.test(k)),
                  ),
                )
              : []

            const html = await fs.readFile(full, "utf8")
            await fs.writeFile(full, setKeywords(html, keywords), "utf8")
            await patchRecord(GENERATED_POSTS, id, keywords)
            await patchRecord(SEARCH_INDEX, id, keywords)
            return sendJson(res, 200, { ok: true, id, keywords })
          }

          // 删除整篇：源文件 + public 下的构建副本 + 两份索引记录
          await fs.unlink(full)
          await rmEmptyDirs(path.dirname(full))
          const publicCopy = path.join(PUBLIC_POSTS, rel)
          await fs.rm(publicCopy, { force: true })
          await rmEmptyDirs(path.dirname(publicCopy), PUBLIC_POSTS)
          await dropRecord(GENERATED_POSTS, id)
          await dropRecord(SEARCH_INDEX, id)
          console.log(`[dev-api] 已删除 posts/${id}（可用 git checkout 恢复）`)
          sendJson(res, 200, { ok: true, id, deleted: true })
        } catch (e: any) {
          console.error("[dev-api]", e)
          sendJson(res, 500, { error: e?.message || "internal error" })
        }
      })
    },
  }
}
