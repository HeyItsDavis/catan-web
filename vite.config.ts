import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Relative base so the build works on GitHub Pages under /<repo>/.
// Routing is hash-based (#/room/ABC) so deep links never 404.
export default defineConfig({
  base: './',
  plugins: [react()],
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**', 'e2e/**'],
  },
})
