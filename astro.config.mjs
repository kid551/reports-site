import { defineConfig } from "astro/config"
import tailwind from "@astrojs/tailwind"

const repo = "reports-site"
const user = "TerenceXie"

export default defineConfig({
  site: `https://${user}.github.io`,
  base: `/${repo}/`,
  trailingSlash: "ignore",
  integrations: [tailwind()],
  build: {
    format: "directory",
  },
})
