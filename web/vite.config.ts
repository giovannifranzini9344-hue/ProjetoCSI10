import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Durante o desenvolvimento, o "proxy" faz o frontend (porta 5173) repassar
// qualquer chamada /api para a API (porta 3001), evitando problemas de CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3001" },
  },
});
