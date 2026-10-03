import { defineConfig } from "vite";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWgslTypeContext, wgslToGlsl } from "./scripts/wgslToGlsl.js";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

function rideWebGlShaders() {
    const shaderRoot = path.join(projectRoot, "src");
    let context;

    const collectSources = (directory, out = []) => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) collectSources(file, out);
            else if (entry.isFile() && entry.name.endsWith(".wgsl")) out.push(readFileSync(file, "utf8"));
        }
        return out;
    };
    const rebuildContext = () => {
        context = createWgslTypeContext(collectSources(shaderRoot));
    };

    rebuildContext();
    return {
        name: "ride-wgsl-to-webgl2-glsl",
        enforce: "pre",
        resolveId(source, importer) {
            const [relativePath, query] = source.split("?");
            if (!importer || query !== "glsl" || !relativePath.endsWith(".wgsl")) return null;
            return `${path.resolve(path.dirname(importer), relativePath)}?glsl`;
        },
        load(id) {
            const [file, query] = id.split("?");
            if (query !== "glsl" || !file.endsWith(".wgsl")) return null;
            if (!context) rebuildContext();
            const source = readFileSync(file, "utf8");
            const glsl = wgslToGlsl(source, context, path.relative(projectRoot, file));
            return `export default ${JSON.stringify(glsl)};`;
        },
        handleHotUpdate({ file }) {
            if (file.endsWith(".wgsl")) rebuildContext();
        },
    };
}

export default defineConfig({
    plugins: [rideWebGlShaders()],
    server: {
        port: 5173,
        strictPort: true,
    },
    build: {
        target: "esnext",
        sourcemap: true,
    },
    // WGSL source imports use ?glsl to be translated to GLSL ES 3.00 during
    // bundling, keeping the WebGL2 runtime free of shader compiler dependencies.
    assetsInclude: ["**/*.hdr", "**/*.env"],
});
