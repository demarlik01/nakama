import path from "path"
import { readFileSync } from "fs"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import YAML from 'yaml'

const ENV_VAR_PATTERN = /\$\{([A-Z0-9_]+)\}/g

const DEFAULT_API_PORT = 3001
// Resolve relative to repo root, not process.cwd() (which may be web/)
const REPO_ROOT = path.resolve(__dirname, "..")

function readApiPort(): number {
  try {
    const configPath = process.env.CONFIG_PATH
      ? path.resolve(REPO_ROOT, process.env.CONFIG_PATH)
      : path.join(REPO_ROOT, "config.yaml")
    const raw = readFileSync(configPath, "utf8")
    const substituted = raw.replace(ENV_VAR_PATTERN, (_match, name) => {
      const value = process.env[name]
      if (value === undefined) return ""
      return value
    })
    const parsed = YAML.parse(substituted)
    const port = Number(parsed?.api?.port)
    return Number.isFinite(port) ? port : DEFAULT_API_PORT
  } catch {
    return DEFAULT_API_PORT
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api": `http://localhost:${readApiPort()}`,
    },
  },
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
  },
})
