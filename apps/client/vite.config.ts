import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // The dev server owns hot reload; the API stays on the Bun server.
    proxy: { "/api": `http://localhost:${process.env.PORT ?? 3000}` },
  },
});
