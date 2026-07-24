import { defineConfig } from "astro/config"
import tailwind from "@astrojs/tailwind"
import { devApi } from "./scripts/dev-api.ts"

const repo = "reports-site"
const user = "kid551"

export default defineConfig({
  site: `https://${user}.github.io`,
  base: `/${repo}/`,
  trailingSlash: "ignore",
  integrations: [tailwind()],
  // devApi 是 apply:"serve" 的插件，只在 dev server 生效，不进构建产物
  vite: {
    plugins: [devApi()],
  },
  build: {
    format: "directory",
  },
})
