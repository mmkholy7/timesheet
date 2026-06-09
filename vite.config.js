import { defineConfig } from 'vite'

// base must match the GitHub Pages project subpath in production,
// but stay at '/' for local dev so `npm run dev` serves from root.
export default defineConfig(({ command }) => ({
  root: '.',
  base: command === 'build' ? '/timesheet/' : '/',
  build: {
    outDir: 'dist'
  }
}))
