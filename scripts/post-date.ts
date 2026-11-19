export interface PathDate {
  /** yyyy-mm-dd，列表页按月分组用 */
  date: string
  /** 14 位 yyyymmddhhmmss，排序用；无 hhmmss 时补 000000 */
  sortKey: string
}

// 2026-05-22-foo | 20260522-foo | 20260522-221424foo | 20260505-020039-foo
const DATE_RE = /^(\d{4})-?(\d{2})-?(\d{2})(?:[-_](\d{2})(\d{2})(\d{2}))?/

function parseName(name: string): PathDate | null {
  const m = name.match(DATE_RE)
  if (!m) return null
  const [, y, mo, d, h = "00", mi = "00", s = "00"] = m
  return { date: `${y}-${mo}-${d}`, sortKey: `${y}${mo}${d}${h}${mi}${s}` }
}

/**
 * 从 posts/ 下的相对路径解析发布日期：先看文件名，文件名没有日期（如目录封面 index.html）
 * 就逐级往上看目录名——目录名里的时间戳就是这组文档的创建时间。都没有返回 null，由调用方退回 mtime。
 */
export function dateFromPath(rel: string): PathDate | null {
  const parts = rel.split(/[/\\]/).filter(Boolean)
  for (let i = parts.length - 1; i >= 0; i--) {
    const hit = parseName(parts[i])
    if (hit) return hit
  }
  return null
}
