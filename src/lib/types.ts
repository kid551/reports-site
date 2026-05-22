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
