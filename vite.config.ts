import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Relative base so the build works on GitHub Pages under /<repo>/.
// Routing is hash-based (#/room/ABC) so deep links never 404.
export default defineConfig({
  base: './',
  plugins: [react()],
})
