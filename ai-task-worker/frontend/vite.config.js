import { defineConfig } from "vite"; import react from "@vitejs/plugin-react";
const t = "http://127.0.0.1:8000";
export default defineConfig({ plugins: [react()], server: { proxy: { "/runs": t, "/screenshots": t, "/portal": t, "/reset": t, "/api": t } } });

