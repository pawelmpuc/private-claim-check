import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  // The Android app shows this build in the system WebView, which on phones that are
  // not kept up to date can be years old. Newer syntax is rewritten so the page still opens.
  build: { target: ['es2020', 'chrome80'] },
});
