import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Relative base so the build works on GitHub Pages under /<repo>/.
// Routing is hash-based (#/room/ABC) so deep links never 404.
export default defineConfig({
  base: './',
  plugins: [react()],
  // The main chunk (React + engine + PeerJS) is ~500 kB / 150 kB gzip; the editor is split off.
  build: { chunkSizeWarningLimit: 700 },
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**', 'e2e/**'],
  },
})
