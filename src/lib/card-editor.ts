/**
 * dev-only 的卡片编辑：标签增删 + 摘要编辑 + 删除整篇文章。
 *
 * 由 index.astro 在 import.meta.env.DEV 下动态 import，build 时整段被摇掉。
 * 写文件走 scripts/dev-api.ts 提供的 PUT /__tags、PUT /__summary 与 DELETE /__post，仅存在于 dev server。
 *
 * 标签控件、摘要文本都位于 <a class="post-card"> 内部，点击必须 preventDefault，否则会跳去文章页；
 * 删除按钮则挂在 <a> 之外（li 的直接子元素），天然不受影响。
 */
import { UNTAGGED } from "./types"

const TAGS_API = "/__tags"
const SUMMARY_API = "/__summary"
const POST_API = "/__post"

const DESC_PLACEHOLDER = "＋ 添加摘要"

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/** data-tags 里的 UNTAGGED 只是筛选用的占位，不是真实标签 */
function tagsOf(li: HTMLLIElement): string[] {
  return (li.dataset.tags || "")
    .split("|")
    .filter(Boolean)
    .filter((t) => t !== UNTAGGED)
}

function writeTags(li: HTMLLIElement, keywords: string[]) {
  const shown = keywords.length ? keywords : [UNTAGGED]
  li.dataset.tags = `|${shown.join("|")}|`
}

function toast(msg: string) {
  const el = document.createElement("div")
  el.className = "tag-toast"
  el.textContent = msg
  document.body.appendChild(el)
  setTimeout(() => el.remove(), 2600)
}

/** 重画一张卡片的标签区（含编辑控件） */
function renderCard(li: HTMLLIElement) {
  const meta = li.querySelector(".post-meta")
  if (!meta) return
  let box = meta.querySelector<HTMLElement>(".tags")
  if (!box) {
    box = document.createElement("span")
    box.className = "tags"
    meta.appendChild(box)
  }
  box.innerHTML =
    tagsOf(li)
      .map(
        (k) =>
          `<span class="cat">${esc(k)}<button type="button" class="tag-del" data-tag="${esc(k)}" title="移除标签">×</button></span>`,
      )
      .join("") + `<button type="button" class="tag-add" title="添加标签">+</button>`
}

/**
 * 按当前 DOM 里的标签重建顶部 chips。
 * 排序规则与 index.astro 保持一致：出现次数降序，「未分类」永远垫底。
 */
function rebuildChips() {
  const nav = document.getElementById("tag-nav")
  const list = document.getElementById("list-default")
  if (!nav || !list) return

  const counts = new Map<string, number>()
  list.querySelectorAll<HTMLLIElement>("li[data-tags]").forEach((li) => {
    const ks = tagsOf(li)
    for (const t of ks.length ? ks : [UNTAGGED]) counts.set(t, (counts.get(t) ?? 0) + 1)
  })
  const tags = Array.from(counts.keys()).sort((a, b) => {
    if (a === UNTAGGED) return 1
    if (b === UNTAGGED) return -1
    return counts.get(b)! - counts.get(a)! || a.localeCompare(b, "zh")
  })

  const active = nav.querySelector("button.active")?.getAttribute("data-tag") || "__all"
  nav.innerHTML =
    `<button type="button" data-tag="__all" class="cat-chip">全部</button>` +
    tags
      .map((t) => `<button type="button" data-tag="${esc(t)}" class="cat-chip">${esc(t)}</button>`)
      .join("")

  // 触发 search-client 的委托 handler，重新套用筛选并设置 active 态；
  // 原先选中的标签若已被删光则退回「全部」
  const target =
    nav.querySelector<HTMLButtonElement>(`button[data-tag="${CSS.escape(active)}"]`) ||
    nav.querySelector<HTMLButtonElement>('button[data-tag="__all"]')
  target?.click()
}

async function save(li: HTMLLIElement, keywords: string[]) {
  const res = await fetch(TAGS_API, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: li.dataset.id, keywords }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || res.statusText)
  writeTags(li, json.keywords)
  renderCard(li)
  rebuildChips()
}

/* ============================ 摘要编辑 ============================ */

/** 没有摘要的卡片补一个占位 <p class="post-desc desc-empty">，让用户能点进去新增 */
function ensureDesc(li: HTMLLIElement) {
  if (li.querySelector(".post-desc")) return
  const title = li.querySelector(".post-title")
  if (!title) return
  const p = document.createElement("p")
  p.className = "post-desc desc-empty"
  p.textContent = DESC_PLACEHOLDER
  title.after(p)
}

/** 保存后把卡片上的摘要文本同步成新值；空串退回占位态 */
function setDescDom(li: HTMLLIElement, description: string) {
  const desc = li.querySelector<HTMLElement>(".post-desc")
  if (!desc) return
  if (description) {
    desc.classList.remove("desc-empty")
    desc.textContent = description
  } else {
    desc.classList.add("desc-empty")
    desc.textContent = DESC_PLACEHOLDER
  }
}

async function saveDesc(li: HTMLLIElement, description: string) {
  const res = await fetch(SUMMARY_API, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: li.dataset.id, description }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || res.statusText)
  setDescDom(li, json.description)
}

/**
 * 点击摘要就地展开一个 textarea：
 * Enter 换行、⌘/Ctrl+Enter 保存、Esc 取消，另配 保存 / 取消 按钮。
 * 整个编辑框自己 stopPropagation，因此不会冒泡到 <a> 触发跳转。
 */
function openDescEditor(li: HTMLLIElement) {
  const desc = li.querySelector<HTMLElement>(".post-desc")
  if (!desc || desc.hidden) return
  const current = desc.classList.contains("desc-empty") ? "" : (desc.textContent || "").trim()

  desc.hidden = true

  const box = document.createElement("div")
  box.className = "desc-edit"

  const ta = document.createElement("textarea")
  ta.className = "desc-input"
  ta.rows = 3
  ta.value = current
  ta.setAttribute("aria-label", "文章摘要")

  const bar = document.createElement("div")
  bar.className = "desc-bar"
  const hint = document.createElement("span")
  hint.className = "desc-hint"
  hint.textContent = "Enter 换行 · ⌘/Ctrl+Enter 保存 · Esc 取消"
  const cancel = document.createElement("button")
  cancel.type = "button"
  cancel.className = "desc-cancel"
  cancel.textContent = "取消"
  const save = document.createElement("button")
  save.type = "button"
  save.className = "desc-save"
  save.textContent = "保存"
  bar.append(hint, cancel, save)

  box.append(ta, bar)
  desc.after(box)
  ta.focus()
  ta.setSelectionRange(ta.value.length, ta.value.length)

  const close = () => {
    box.remove()
    desc.hidden = false
  }
  const commit = async () => {
    save.disabled = true
    cancel.disabled = true
    try {
      await saveDesc(li, ta.value.trim())
      close()
    } catch (err: any) {
      toast(err?.message || "保存失败")
      save.disabled = false
      cancel.disabled = false
    }
  }

  // 编辑框内的任何点击都别冒泡到 <a>，否则点进文本框就跳文章页
  box.addEventListener("click", (e) => {
    e.preventDefault()
    e.stopPropagation()
  })
  ta.addEventListener("keydown", (e) => {
    e.stopPropagation()
    if (e.key === "Escape") {
      e.preventDefault()
      close()
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      commit()
    }
    // 普通 Enter 交给 textarea 默认行为（换行）
  })
  save.addEventListener("click", commit)
  cancel.addEventListener("click", close)
}

/* ============================ 标签编辑 ============================ */

/** 把 [+] 就地换成输入框 */
function openInput(li: HTMLLIElement) {
  const addBtn = li.querySelector<HTMLButtonElement>(".tag-add")
  if (!addBtn) return
  const input = document.createElement("input")
  input.className = "tag-input"
  input.placeholder = "标签名"
  input.setAttribute("aria-label", "新标签名")
  addBtn.replaceWith(input)
  input.focus()

  let committed = false
  const close = () => renderCard(li)

  input.addEventListener("click", (e) => {
    e.preventDefault()
    e.stopPropagation()
  })
  input.addEventListener("blur", () => {
    if (!committed) close()
  })
  input.addEventListener("keydown", async (e) => {
    e.stopPropagation()
    if (e.key === "Escape") {
      e.preventDefault()
      close()
      return
    }
    if (e.key !== "Enter") return
    e.preventDefault()

    const value = input.value.trim()
    const current = tagsOf(li)
    if (!value || value === UNTAGGED || current.includes(value)) {
      if (value === UNTAGGED) toast(`「${UNTAGGED}」是保留名，换一个`)
      close()
      return
    }

    committed = true
    input.disabled = true
    try {
      await save(li, [...current, value])
    } catch (err: any) {
      toast(err?.message || "保存失败")
      close()
    }
  })
}

/** 删除按钮挂在 <a> 外面，所以不用担心触发卡片跳转 */
function mountDeleteButton(li: HTMLLIElement) {
  if (li.querySelector(".post-del")) return
  const btn = document.createElement("button")
  btn.type = "button"
  btn.className = "post-del"
  btn.title = "删除这篇文章"
  btn.textContent = "×"
  li.appendChild(btn)
}

/** 两段式确认：首次点击进入待确认态，5 秒无操作自动复原 */
function armDelete(btn: HTMLButtonElement) {
  if (btn.dataset.armed === "1") return
  btn.dataset.armed = "1"
  btn.classList.add("armed")
  btn.textContent = "确认删除？"
  const reset = () => {
    delete btn.dataset.armed
    btn.classList.remove("armed")
    btn.textContent = "×"
  }
  setTimeout(reset, 5000)
  btn.focus() // 便于键盘直接回车确认；不监听 blur，否则切窗口就会莫名撤销
}

async function removePost(li: HTMLLIElement) {
  const res = await fetch(POST_API, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: li.dataset.id }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || res.statusText)

  const group = li.closest<HTMLElement>("div[data-month]")
  const folder = li.closest<HTMLElement>("li.folder-item")
  li.remove()
  // 目录组：更新「N 篇」计数，删空了就把整组收掉
  if (folder) {
    const left = folder.querySelectorAll("li[data-id]").length
    if (left === 0) folder.remove()
    else {
      const counter = folder.querySelector(".folder-count")
      if (counter) counter.textContent = `${left} 篇`
    }
  }
  // 该月份只剩这一篇时，把空的月份分组一并收掉
  if (group && !group.querySelector("li[data-id]")) group.remove()

  const counter = document.querySelector(".site-header .lede b")
  if (counter) {
    counter.textContent = String(document.querySelectorAll("#list-default li[data-id]").length)
  }
  rebuildChips()
  toast("已删除，可用 git checkout 恢复")
}

export function initCardEditor() {
  const list = document.getElementById("list-default")
  if (!list) return

  list.querySelectorAll<HTMLLIElement>("li[data-id]").forEach((li) => {
    renderCard(li)
    ensureDesc(li)
    mountDeleteButton(li)
  })
  document.body.classList.add("tag-editing")

  list.addEventListener("click", async (e) => {
    const target = e.target as HTMLElement
    const del = target.closest<HTMLElement>(".tag-del")
    const add = target.closest<HTMLElement>(".tag-add")
    const postDel = target.closest<HTMLButtonElement>(".post-del")
    // 编辑框（.desc-edit）内部点击已自行 stopPropagation，不会到这里；
    // 命中的只会是尚未展开的 .post-desc
    const descEl = target.closest<HTMLElement>(".post-desc")
    if (!del && !add && !postDel && !descEl) return

    // 控件 / 摘要都位于 <a class="post-card"> 内部，不拦就会跳转
    e.preventDefault()
    e.stopPropagation()

    const li = target.closest<HTMLLIElement>("li[data-id]")
    if (!li) return

    if (descEl) {
      openDescEditor(li)
      return
    }

    if (postDel) {
      if (postDel.dataset.armed !== "1") return armDelete(postDel)
      try {
        await removePost(li)
      } catch (err: any) {
        toast(err?.message || "删除失败")
      }
      return
    }

    if (add) {
      openInput(li)
      return
    }
    const tag = del!.getAttribute("data-tag") || ""
    try {
      await save(
        li,
        tagsOf(li).filter((k) => k !== tag),
      )
    } catch (err: any) {
      toast(err?.message || "删除失败")
    }
  })
}
