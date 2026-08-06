import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Local default `/`; GitHub Pages workflow sets VITE_BASE_PATH=/FollowUp/
const base = process.env.VITE_BASE_PATH || '/'

export default defineConfig({
  plugins: [react()],
  base,
})
