import { spawnSync } from "node:child_process"
import readline from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"

const sh = (cmd: string, args: string[]): { code: number; stdout: string; stderr: string } => {
  const r = spawnSync(cmd, args, { encoding: "utf8" })
  return {
    code: r.status ?? -1,
    stdout: (r.stdout || "").trim(),
    stderr: (r.stderr || "").trim(),
  }
}

const run = (cmd: string, args: string[]) => {
  const r = spawnSync(cmd, args, { stdio: "inherit" })
  return r.status ?? -1
}

function fail(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

const args = process.argv.slice(2)
const yes = args.includes("-y") || args.includes("--yes")
const messageArgIdx = args.findIndex((a) => a === "-m" || a === "--message")
const customMessage = messageArgIdx >= 0 ? args[messageArgIdx + 1] : null

// 1. branch check
const branch = sh("git", ["rev-parse", "--abbrev-ref", "HEAD"]).stdout
if (branch !== "main") {
  fail(`当前分支是 ${branch}，请切换到 main 再发布。`)
}

// 2. remote check
const remote = sh("git", ["remote"]).stdout
if (!remote) {
  fail(
    "仓库还没有配置 remote。\n  执行 `git remote add origin git@github.com:<user>/reports-site.git` 后重试。",
  )
}

// 3. status
const statusOut = sh("git", ["status", "--porcelain"]).stdout
if (!statusOut) {
  console.log("ℹ 没有需要提交的变更。")
  // still try to push in case local is ahead
  const ahead = sh("git", ["rev-list", "--count", "@{u}..HEAD"]).stdout
  if (ahead && ahead !== "0") {
    console.log(`↑ 本地领先远端 ${ahead} 个 commit，执行 git push...`)
    const code = run("git", ["push"])
    process.exit(code)
  }
  process.exit(0)
}

// 4. show changes
console.log("以下变更将被提交：")
console.log("─".repeat(50))
console.log(statusOut)
console.log("─".repeat(50))

const fileLines = statusOut.split("\n").map((l) => l.slice(3))
const postChanges = fileLines.filter((f) => f.startsWith("posts/"))
const defaultMessage =
  postChanges.length > 0
    ? `posts: update ${postChanges.length} file(s)`
    : "chore: update site"
const message = customMessage || defaultMessage

console.log(`提交信息: ${message}`)

// 5. confirm
if (!yes) {
  const rl = readline.createInterface({ input, output })
  const ans = (await rl.question("继续发布？[y/N] ")).trim().toLowerCase()
  rl.close()
  if (ans !== "y" && ans !== "yes") {
    console.log("已取消。")
    process.exit(0)
  }
}

// 6. add + commit + push
let code = run("git", ["add", "-A"])
if (code !== 0) fail("git add 失败")

code = run("git", ["commit", "-m", message])
if (code !== 0) fail("git commit 失败")

code = run("git", ["push"])
if (code !== 0) {
  // first push may need to set upstream
  const upstream = sh("git", ["rev-parse", "--abbrev-ref", "@{u}"]).code
  if (upstream !== 0) {
    console.log("↑ 设置 upstream 并推送...")
    code = run("git", ["push", "-u", "origin", branch])
  }
  if (code !== 0) fail("git push 失败")
}

console.log("\n✓ 推送完成。GitHub Actions 会自动构建并发布。")
console.log("  查看进度: 仓库页面 → Actions 标签")
