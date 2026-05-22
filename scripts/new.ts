import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(fileURLToPath(import.meta.url), "../..")

function today(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9一-龥-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

const args = process.argv.slice(2)
if (!args.length) {
  console.error("用法: pnpm new <slug-or-title> [--category <name>]")
  process.exit(1)
}

let category: string | null = null
const positional: string[] = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--category" || args[i] === "-c") {
    category = args[++i] ?? null
  } else {
    positional.push(args[i])
  }
}

const rawTitle = positional.join(" ")
const slug = slugify(rawTitle) || "untitled"
const date = today()
const fileName = `${date}-${slug}.html`
const targetDir = category ? path.join(root, "posts", category) : path.join(root, "posts")
const target = path.join(targetDir, fileName)

const title = rawTitle || slug

const skeleton = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title}</title>
  <meta name="description" content="" />
  <meta name="keywords" content="" />
  <style>
    body { max-width: 720px; margin: 40px auto; padding: 0 20px; font: 16px/1.7 ui-sans-serif, -apple-system, "PingFang SC", "Hiragino Sans GB", sans-serif; color: #1e293b; }
    h1 { font-size: 28px; margin-top: 0; }
    h2 { font-size: 20px; margin-top: 32px; }
    p { margin: 12px 0; }
    pre, code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    pre { background: #f1f5f9; padding: 12px; border-radius: 8px; overflow-x: auto; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p>正文从这里开始……</p>
</body>
</html>
`

await fs.mkdir(targetDir, { recursive: true })
try {
  await fs.access(target)
  console.error(`已存在: ${path.relative(root, target)}`)
  process.exit(1)
} catch {
  // does not exist, proceed
}

await fs.writeFile(target, skeleton, "utf8")
console.log(`✓ 已创建 ${path.relative(root, target)}`)
