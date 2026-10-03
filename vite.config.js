import { defineConfig } from "vite";

export default defineConfig({
    server: {
        port: 5173,
        strictPort: true,
    },
    build: {
        target: "esnext",
        sourcemap: true,
    },
    // Native GLSL shader strings are imported with Vite's standard ?raw loader.
    assetsInclude: ["**/*.hdr", "**/*.env"],
});
