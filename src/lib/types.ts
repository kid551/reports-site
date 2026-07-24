/** 没有 <meta name="keywords"> 的文章归入此标签 */
export const UNTAGGED = "未分类"

export interface PostMeta {
  id: string
  href: string
  title: string
  description: string
  date: string
  category: string
  keywords: string[]
}

export interface SearchDoc extends PostMeta {
  body: string
}
