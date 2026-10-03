/**
 * Deterministic, player-centred coastal plants.
 *
 * Three shared low-poly meshes (grass, scrub and wind-shaped pines) are drawn
 * with thin instances. Placement is hashed from absolute world-grid cells, so
 * crossing the bounded render window never changes a plant's identity. The
 * window is deliberately much smaller than the terrain clipmap, leaves the
 * shoreline and surf lane bare, and fades its outer ring into the sky haze.
 */

import "@babylonjs/core/Meshes/thinInstanceMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import { Matrix, Quaternion, Vector2, Vector3, Vector4 } from "@babylonjs/core/Maths/math.vector";

import { S } from "../core/settings.js";
import { CASCADE_COUNT } from "../render/shadows.js";
import { OUTER_EXTENT } from "../terrain/clipmapMesh.js";
import { bindMatrixArray, whenReady } from "../core/gpuUtil.js";

const TILE_SIZE = 48;
const RADIUS = Math.min(560, OUTER_EXTENT * 0.66);
const REBUILD_MARGIN = TILE_SIZE * 1.5;
const SETTINGS_SETTLE_SECONDS = 0.18;
const _focus = new Vector2();
const _wind = new Vector2();
const _splits = new Vector4();
const _scale = new Vector3(1, 1, 1);
const _rotation = new Quaternion();
const _translation = new Vector3();
const _matrix = new Matrix();

const PI2 = Math.PI * 2;

export class CoastalVegetation {
    /**
     * @param {import("@babylonjs/core/scene").Scene} scene
     * @param {import("../terrain/terrain.js").Terrain} terrain
     * @param {import("../render/sky.js").Sky} sky
     * @param {import("../render/shadows.js").ShadowSystem} shadows
     * @param {import("../render/depthPass.js").DepthPass} depthPass
     */
    constructor(scene, terrain, sky, shadows, depthPass) {
        this.scene = scene;
        this.terrain = terrain;
        this.sky = sky;
        this.shadows = shadows;
        this.time = 0;
        this.radius = RADIUS;
        this._lastCellX = NaN;
        this._lastCellZ = NaN;
        this._lastDensity = NaN;
        this._lastCoastline = NaN;
        this._requestedDensity = NaN;
        this._requestedCoastline = NaN;
        this._settingsSettle = 0;

        this.items = [
            this._createItem("duneGrass", makeGrassGeometry(), 1, Math.min(220, RADIUS)),
            this._createItem("coastalScrub", makeScrubGeometry(), 2, Math.min(370, RADIUS)),
            this._createItem("coastalPines", makePineGeometry(), 2, RADIUS),
        ];

        for (const item of this.items) {
            shadows.registerCaster(
                item.mesh,
                (cascade) => this._makeDepthMaterial(item, cascade),
                item.cascades
            );
            item.prepassMaterial = this._makePrepassMaterial(item);
            depthPass.registerCaster(item.mesh, item.prepassMaterial);
        }
    }

    _createItem(name, data, cascades, radius) {
        const mesh = new Mesh(name, this.scene);
        data.applyToMesh(mesh, false);
        mesh.isPickable = false;
        mesh.alwaysSelectAsActiveMesh = true;
        mesh.doNotSyncBoundingInfo = true;
        mesh.renderingGroupId = 1;
        mesh.metadata = { triangles: mesh.getTotalIndices() / 3 };
        mesh.freezeWorldMatrix();

        const material = this._makeBeautyMaterial(name);
        material.backFaceCulling = false;
        material.setTexture("skyLUT", this.sky.lut);
        for (let i = 0; i < CASCADE_COUNT; i++) {
            material.setTexture("cascade" + i, this.shadows.maps[i]);
        }
        mesh.material = material;

        // Keep a small, growable dynamic buffer. It is resized only if density
        // exceeds the previous maximum, and otherwise receives one update when
        // the player crosses a placement tile.
        const initial = new Float32Array(16 * 16);
        mesh.thinInstanceSetBuffer("matrix", initial, 16, false);
        mesh.thinInstanceCount = 0;

        return {
            name,
            mesh,
            material,
            cascades,
            radius,
            depthMaterials: [],
            transforms: initial,
            count: 0,
            prepassMaterial: null,
        };
    }

    _makeBeautyMaterial(name) {
        return new ShaderMaterial(
            name + "Material",
            this.scene,
            { vertex: "coastVegetation", fragment: "coastVegetation" },
            {
                attributes: ["position", "normal", "color"],
                uniforms: [
                    "viewProjection", "world", "cameraPos", "vegetationFocus", "vegetationRadius",
                    "shorelineZ", "coastlineVariation",
                    "vegetationTime", "vegetationWindDir", "vegetationWindStrength",
                    "sunDir", "sunRadiance", "shR", "cascadeMatrices", "cascadeSplits",
                    "cascadeParams", "shadowTexel", "shadowSoftness", "shadowBias",
                    "ambientIntensity", "fogDensity", "fogHeightFalloff", "fogStart", "aerialStrength",
                ],
                samplers: ["skyLUT", "cascade0", "cascade1", "cascade2"],
                shaderLanguage: ShaderLanguage.GLSL,
            }
        );
    }

    _makePrepassMaterial(item) {
        const material = new ShaderMaterial(
            item.name + "Prepass",
            this.scene,
            { vertex: "coastVegetationPrepass", fragment: "coastVegetationPrepass" },
            {
                attributes: ["position"],
                uniforms: [
                    "viewProjection", "world", "vegetationTime", "vegetationWindDir", "vegetationWindStrength",
                    "vegetationFocus", "vegetationRadius", "shorelineZ", "coastlineVariation",
                ],
                shaderLanguage: ShaderLanguage.GLSL,
            }
        );
        material.backFaceCulling = false;
        return material;
    }

    _makeDepthMaterial(item, cascade) {
        const material = new ShaderMaterial(
            item.name + "Depth" + cascade,
            this.scene,
            { vertex: "coastVegetationDepth", fragment: "coastVegetationDepth" },
            {
                attributes: ["position"],
                uniforms: [
                    "lightViewProjection", "world", "vegetationTime", "vegetationWindDir", "vegetationWindStrength",
                    "vegetationFocus", "vegetationRadius", "shorelineZ", "coastlineVariation",
                ],
                shaderLanguage: ShaderLanguage.GLSL,
                defines: ["RIDE_CASCADE " + cascade],
            }
        );
        material.backFaceCulling = false;
        item.depthMaterials.push(material);
        return material;
    }

    /** Compile each vegetation pipeline while the loading screen is up. */
    async warmUp() {
        for (const item of this.items) {
            const mesh = item.mesh;
            await whenReady(item.material, item.name + " beauty", [mesh, true]);
            await whenReady(item.prepassMaterial, item.name + " prepass", [mesh, true]);
            for (let i = 0; i < item.depthMaterials.length; i++) {
                await whenReady(item.depthMaterials[i], item.name + " shadow " + i, [mesh, true]);
            }
        }
    }

    /**
     * Update shared shader uniforms every frame; rebuild transforms only when
     * the focus crosses a tile or the user changes vegetation density.
     * @param {number} dt
     * @param {{x:number,z:number}} focus
     * @param {Vector3} cameraPos
     */
    update(dt, focus, cameraPos) {
        const x = Number.isFinite(focus?.x) ? focus.x : 0;
        const z = Number.isFinite(focus?.z) ? focus.z : 0;
        const cellX = Math.floor(x / TILE_SIZE);
        const cellZ = Math.floor(z / TILE_SIZE);
        const density = clamp(Number.isFinite(S.greeneryDensity) ? S.greeneryDensity : 1, 0, 2);
        const coastline = clamp(Number.isFinite(S.coastlineVariation) ? S.coastlineVariation : 1, 0, 2);

        const initial = !Number.isFinite(this._lastCellX);
        const cellChanged = cellX !== this._lastCellX || cellZ !== this._lastCellZ;
        if (initial) {
            this._requestedDensity = density;
            this._requestedCoastline = coastline;
            this._settingsSettle = 0;
            this._rebuild(x, z, density);
            this._lastCellX = cellX;
            this._lastCellZ = cellZ;
            this._lastDensity = density;
            this._lastCoastline = coastline;
        } else {
            if (density !== this._requestedDensity || coastline !== this._requestedCoastline) {
                this._requestedDensity = density;
                this._requestedCoastline = coastline;
                this._settingsSettle = SETTINGS_SETTLE_SECONDS;
            }

            if (this._settingsSettle > 0) {
                // Density and shore-shape sliders can emit many input events
                // per second. Wait for the drag to pause, then pay for one
                // deterministic rebuild at the latest focus and settings.
                const elapsed = Math.max(1 / 60, Number.isFinite(dt) ? Math.max(0, dt) : 0);
                this._settingsSettle -= elapsed;
                if (this._settingsSettle <= 0) {
                    this._rebuild(x, z, this._requestedDensity);
                    this._lastCellX = cellX;
                    this._lastCellZ = cellZ;
                    this._lastDensity = this._requestedDensity;
                    this._lastCoastline = this._requestedCoastline;
                }
            } else if (cellChanged) {
                this._rebuild(x, z, density);
                this._lastCellX = cellX;
                this._lastCellZ = cellZ;
                this._lastDensity = density;
                this._lastCoastline = coastline;
            }
        }

        this.time += Math.max(0, Number.isFinite(dt) ? dt : 0);
        _focus.set(x, z);
        const angle = (S.windDirection * Math.PI) / 180;
        _wind.set(Math.sin(angle), Math.cos(angle));
        for (const item of this.items) {
            item.mesh.isVisible = !!S.showGreenery && item.count > 0;
            this._pushFrameUniforms(item, cameraPos);
        }
    }

    setEnabled(enabled) {
        for (const item of this.items) item.mesh.isVisible = !!enabled && item.count > 0;
    }

    _pushFrameUniforms(item, cameraPos) {
        const m = item.material;
        const sh = this.shadows;
        m.setVector3("cameraPos", cameraPos);
        m.setVector2("vegetationFocus", _focus);
        m.setFloat("vegetationRadius", item.radius);
        m.setFloat("shorelineZ", this.terrain.heightfield.shorelineZ);
        m.setFloat("coastlineVariation", S.coastlineVariation);
        m.setFloat("vegetationTime", this.time);
        m.setVector2("vegetationWindDir", _wind);
        m.setFloat("vegetationWindStrength", S.windStrength);
        m.setVector3("sunDir", this.sky.sunDir);
        m.setColor3("sunRadiance", this.sky.sunRadiance);
        m.setArray4("shR", this.sky.sh);
        bindMatrixArray(m, "cascadeMatrices", sh.matrixData);
        _splits.set(sh.splits[0], sh.splits[1], sh.splits[2], sh.splits[3]);
        m.setVector4("cascadeSplits", _splits);
        m.setArray4("cascadeParams", sh.paramData);
        m.setFloat("shadowTexel", sh.texelSize);
        m.setFloat("shadowSoftness", 1.35);
        m.setFloat("shadowBias", 0.04);
        m.setFloat("ambientIntensity", S.ambientIntensity);
        m.setFloat("fogDensity", S.fogDensity);
        m.setFloat("fogHeightFalloff", S.fogHeightFalloff);
        m.setFloat("fogStart", S.fogStart);
        m.setFloat("aerialStrength", S.aerialStrength);

        const p = item.prepassMaterial;
        p.setFloat("vegetationTime", this.time);
        p.setVector2("vegetationWindDir", _wind);
        p.setFloat("vegetationWindStrength", S.windStrength);
        p.setVector2("vegetationFocus", _focus);
        p.setFloat("vegetationRadius", item.radius);
        p.setFloat("shorelineZ", this.terrain.heightfield.shorelineZ);
        p.setFloat("coastlineVariation", S.coastlineVariation);
        for (const d of item.depthMaterials) {
            d.setFloat("vegetationTime", this.time);
            d.setVector2("vegetationWindDir", _wind);
            d.setFloat("vegetationWindStrength", S.windStrength);
            d.setVector2("vegetationFocus", _focus);
            d.setFloat("vegetationRadius", item.radius);
            d.setFloat("shorelineZ", this.terrain.heightfield.shorelineZ);
            d.setFloat("coastlineVariation", S.coastlineVariation);
        }
    }

    _rebuild(focusX, focusZ, density) {
        const lists = [[], [], []];
        if (density > 0) {
            scatterCover(lists[0], focusX, focusZ, this.items[0].radius, density, this.terrain);
            scatterScrub(lists[1], focusX, focusZ, this.items[1].radius, density, this.terrain);
            scatterTrees(lists[2], focusX, focusZ, this.items[2].radius, density, this.terrain);
        }
        for (let i = 0; i < this.items.length; i++) {
            this._uploadInstances(this.items[i], lists[i]);
        }
    }

    _uploadInstances(item, plants) {
        const required = plants.length * 16;
        if (required > item.transforms.length) {
            let capacity = item.transforms.length;
            while (capacity < required) capacity *= 2;
            item.transforms = new Float32Array(capacity);
            item.mesh.thinInstanceSetBuffer("matrix", item.transforms, 16, false);
        }

        for (let i = 0; i < plants.length; i++) {
            const plant = plants[i];
            _scale.set(plant.scale, plant.scale, plant.scale);
            Quaternion.RotationYawPitchRollToRef(plant.yaw, 0, 0, _rotation);
            _translation.set(plant.x, plant.y, plant.z);
            Matrix.ComposeToRef(_scale, _rotation, _translation, _matrix);
            _matrix.copyToArray(item.transforms, i * 16);
        }

        item.count = plants.length;
        item.mesh.thinInstanceCount = plants.length;
        item.mesh.thinInstanceBufferUpdated("matrix");
    }

    get triangles() {
        if (!S.showGreenery) return 0;
        let total = 0;
        for (const item of this.items) {
            if (item.mesh.isVisible) total += item.mesh.metadata.triangles * item.count;
        }
        return total;
    }

    dispose() {
        for (const item of this.items) {
            item.mesh.dispose();
            item.material.dispose();
            item.prepassMaterial.dispose();
            for (const material of item.depthMaterials) material.dispose();
        }
    }
}

function scatterCover(out, focusX, focusZ, radius, density, terrain) {
    const spacing = 4.8;
    const buildRadius = radius + REBUILD_MARGIN;
    visitCells(focusX, focusZ, buildRadius, spacing, (gx, gz, x0, z0, d2) => {
        const shore = terrain.shorelineAt(x0) - z0;
        if (shore < 7 || d2 > buildRadius * buildRadius) return;
        const band = smooth01((shore - 6) / 12) * (1 - smooth01((shore - 98) / 38));
        const rx = hash01(gx, gz, 7);
        const rz = hash01(gx, gz, 31);
        const x = x0 + (rx - 0.5) * spacing * 0.76;
        const z = z0 + (rz - 0.5) * spacing * 0.76;
        const plantDistance = (x - focusX) ** 2 + (z - focusZ) ** 2;
        const chance = Math.min(0.92, 0.4 * density * band);
        if (plantDistance > buildRadius * buildRadius || hash01(gx, gz, 101) > chance) return;
        out.push({
            x, z, y: terrain.heightAt(x, z),
            yaw: hash01(gx, gz, 173) * PI2,
            scale: 1.0 + hash01(gx, gz, 239) * 0.8,
        });
    });
    scatterClumps(out, focusX, focusZ, buildRadius, density, terrain, {
        tag: 1201, cellX: 36, cellZ: 30, shoreMin: 12, shoreMax: 72,
        chance: 0.4, offsets: [[-2.2, -1.0], [1.8, -1.4], [-1.4, 2.0], [2.3, 2.1]],
        scaleMin: 1.25, scaleMax: 1.95,
    });
}

function scatterScrub(out, focusX, focusZ, radius, density, terrain) {
    const spacing = 13.5;
    const buildRadius = radius + REBUILD_MARGIN;
    visitCells(focusX, focusZ, buildRadius, spacing, (gx, gz, x0, z0, d2) => {
        const shore = terrain.shorelineAt(x0) - z0;
        if (shore < 16 || shore > 335 || d2 > buildRadius * buildRadius) return;
        const band = smooth01((shore - 16) / 20) * (1 - smooth01((shore - 285) / 50));
        const x = x0 + (hash01(gx, gz, 13) - 0.5) * spacing * 0.68;
        const z = z0 + (hash01(gx, gz, 47) - 0.5) * spacing * 0.68;
        if ((x - focusX) ** 2 + (z - focusZ) ** 2 > buildRadius * buildRadius) return;
        if (hash01(gx, gz, 107) > Math.min(0.82, 0.4 * density * band)) return;
        out.push({
            x, z, y: terrain.heightAt(x, z),
            yaw: hash01(gx, gz, 181) * PI2,
            scale: 0.75 + hash01(gx, gz, 251) * 0.66,
        });
    });
    scatterClumps(out, focusX, focusZ, buildRadius, density, terrain, {
        tag: 2204, cellX: 58, cellZ: 42, shoreMin: 24, shoreMax: 132,
        chance: 0.28, offsets: [[-4.0, -0.6], [3.2, -2.4], [1.2, 3.8]],
        scaleMin: 1.05, scaleMax: 1.7,
    });
}

function scatterTrees(out, focusX, focusZ, radius, density, terrain) {
    const spacing = 23.5;
    const buildRadius = radius + REBUILD_MARGIN;
    visitCells(focusX, focusZ, buildRadius, spacing, (gx, gz, x0, z0, d2) => {
        const shore = terrain.shorelineAt(x0) - z0;
        if (shore < 18 || shore > 310 || d2 > buildRadius * buildRadius) return;
        // Put the strongest tree line behind the dunes, where it frames the
        // rider at normal camera distance. A light falloff beyond the inland
        // treeline avoids filling the whole horizon with tiny repeated pines.
        const band = smooth01((shore - 18) / 26) * (1 - smooth01((shore - 220) / 90));
        const x = x0 + (hash01(gx, gz, 17) - 0.5) * spacing * 0.64;
        const z = z0 + (hash01(gx, gz, 53) - 0.5) * spacing * 0.64;
        if ((x - focusX) ** 2 + (z - focusZ) ** 2 > buildRadius * buildRadius) return;
        if (hash01(gx, gz, 113) > Math.min(0.96, 0.42 * density * band)) return;
        out.push({
            x, z, y: terrain.heightAt(x, z),
            yaw: hash01(gx, gz, 191) * PI2,
            scale: 1.25 + hash01(gx, gz, 263) * 0.85,
        });
    });
    scatterClumps(out, focusX, focusZ, buildRadius, density, terrain, {
        tag: 3220, cellX: 84, cellZ: 60, shoreMin: 32, shoreMax: 144,
        chance: 0.4, offsets: [[-8.6, -1.6], [0.8, -6.0], [8.2, 1.8], [-1.8, 7.2]],
        scaleMin: 1.35, scaleMax: 2.15,
    });
}

/** Add sparse, repeatable plant groups while retaining the existing archetype batches. */
function scatterClumps(out, focusX, focusZ, buildRadius, density, terrain, spec) {
    const maxOffset = spec.offsets.reduce((max, offset) => Math.max(max, Math.hypot(offset[0], offset[1])), 0);
    const visitRadius = buildRadius + maxOffset + Math.hypot(spec.cellX, spec.cellZ) * 0.5;
    const minX = Math.floor((focusX - visitRadius) / spec.cellX);
    const maxX = Math.floor((focusX + visitRadius) / spec.cellX);
    const minZ = Math.floor((focusZ - visitRadius) / spec.cellZ);
    const maxZ = Math.floor((focusZ + visitRadius) / spec.cellZ);

    for (let gz = minZ; gz <= maxZ; gz++) {
        for (let gx = minX; gx <= maxX; gx++) {
            const centerX = (gx + 0.5) * spec.cellX
                + (hash01(gx, gz, spec.tag + 1) - 0.5) * spec.cellX * 0.24;
            const centerZ = (gz + 0.5) * spec.cellZ
                + (hash01(gx, gz, spec.tag + 2) - 0.5) * spec.cellZ * 0.24;
            const centerDistance = Math.hypot(centerX - focusX, centerZ - focusZ);
            if (centerDistance > visitRadius) continue;

            const shore = terrain.shorelineAt(centerX) - centerZ;
            if (shore < spec.shoreMin || shore > spec.shoreMax) continue;
            const shoreFade = smooth01((shore - spec.shoreMin) / 10)
                * (1 - smooth01((shore - spec.shoreMax + 18) / 22));
            if (hash01(gx, gz, spec.tag + 3) > Math.min(0.55, spec.chance * density * shoreFade)) continue;

            const yaw = hash01(gx, gz, spec.tag + 4) * PI2;
            const c = Math.cos(yaw), s = Math.sin(yaw);
            for (let i = 0; i < spec.offsets.length; i++) {
                const offset = spec.offsets[i];
                const jitter = 0.78 + hash01(gx, gz, spec.tag + 11 + i) * 0.44;
                const x = centerX + (offset[0] * c - offset[1] * s) * jitter;
                const z = centerZ + (offset[0] * s + offset[1] * c) * jitter;
                if ((x - focusX) ** 2 + (z - focusZ) ** 2 > buildRadius * buildRadius) continue;

                const plantShore = terrain.shorelineAt(x) - z;
                if (plantShore < spec.shoreMin - 3 || plantShore > spec.shoreMax + 8) continue;
                const scaleT = hash01(gx, gz, spec.tag + 29 + i);
                out.push({
                    x, z, y: terrain.heightAt(x, z),
                    yaw: hash01(gx, gz, spec.tag + 41 + i) * PI2,
                    scale: spec.scaleMin + scaleT * (spec.scaleMax - spec.scaleMin),
                });
            }
        }
    }
}

function visitCells(focusX, focusZ, radius, spacing, fn) {
    const minX = Math.floor((focusX - radius) / spacing);
    const maxX = Math.floor((focusX + radius) / spacing);
    const minZ = Math.floor((focusZ - radius) / spacing);
    const maxZ = Math.floor((focusZ + radius) / spacing);
    for (let gz = minZ; gz <= maxZ; gz++) {
        const z = (gz + 0.5) * spacing;
        for (let gx = minX; gx <= maxX; gx++) {
            const x = (gx + 0.5) * spacing;
            fn(gx, gz, x, z, (x - focusX) ** 2 + (z - focusZ) ** 2);
        }
    }
}

function hash01(x, z, salt) {
    let h = Math.imul((x | 0) ^ Math.imul(salt + 0x9e3779b9, 0x85ebca6b), 0xc2b2ae35);
    h ^= Math.imul((z | 0) + salt, 0x27d4eb2f);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
}

function smooth01(v) {
    const t = clamp(v, 0, 1);
    return t * t * (3 - 2 * t);
}

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

class GeometryBuilder {
    constructor() {
        this.positions = [];
        this.normals = [];
        this.colors = [];
        this.indices = [];
    }

    vertex(x, y, z, color) {
        this.positions.push(x, y, z);
        this.normals.push(0, 0, 0);
        this.colors.push(color[0], color[1], color[2], 1);
        return this.positions.length / 3 - 1;
    }

    triangle(a, b, c) {
        this.indices.push(a, b, c);
    }

    finish(name) {
        const normals = computeNormals(this.positions, this.indices);
        const data = new VertexData();
        data.positions = new Float32Array(this.positions);
        data.normals = normals;
        data.colors = new Float32Array(this.colors);
        data.indices = new Uint32Array(this.indices);
        data.name = name;
        return data;
    }
}

function computeNormals(positions, indices) {
    const normals = new Float32Array(positions.length);
    for (let i = 0; i < indices.length; i += 3) {
        const a = indices[i] * 3;
        const b = indices[i + 1] * 3;
        const c = indices[i + 2] * 3;
        const ux = positions[b] - positions[a];
        const uy = positions[b + 1] - positions[a + 1];
        const uz = positions[b + 2] - positions[a + 2];
        const vx = positions[c] - positions[a];
        const vy = positions[c + 1] - positions[a + 1];
        const vz = positions[c + 2] - positions[a + 2];
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        for (const o of [a, b, c]) {
            normals[o] += nx;
            normals[o + 1] += ny;
            normals[o + 2] += nz;
        }
    }
    for (let i = 0; i < normals.length; i += 3) {
        const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
        normals[i] /= len;
        normals[i + 1] /= len;
        normals[i + 2] /= len;
    }
    return normals;
}

function makeGrassGeometry() {
    const b = new GeometryBuilder();
    const count = 12;
    for (let i = 0; i < count; i++) {
        const a = (i / count) * PI2 + (i % 3) * 0.19;
        const h = 0.72 + ((i * 37) % 7) * 0.085;
        const w = 0.04 + ((i * 19) % 5) * 0.007;
        const color = i % 3 === 0 ? [0.17, 0.30, 0.072] : i % 3 === 1 ? [0.13, 0.25, 0.052] : [0.22, 0.36, 0.092];
        addBlade(b, Math.cos(a), Math.sin(a), h, w, color);
    }
    return b.finish("coastal grass tuft");
}

function addBlade(b, dx, dz, height, width, color) {
    const sideX = -dz;
    const sideZ = dx;
    const lean = 0.22 * height;
    let previous = null;
    const ts = [0, 0.52, 1];
    for (let r = 0; r < ts.length; r++) {
        const t = ts[r];
        const cx = dx * lean * t * t;
        const cz = dz * lean * t * t;
        const taper = r === 0 ? 0.42 : r === 1 ? 0.74 : 0.012;
        const half = width * taper;
        const c = [
            color[0] * (0.74 + 0.32 * t),
            color[1] * (0.80 + 0.30 * t),
            color[2] * (0.74 + 0.33 * t),
        ];
        const left = b.vertex(cx - sideX * half, height * t, cz - sideZ * half, c);
        const right = b.vertex(cx + sideX * half, height * t, cz + sideZ * half, c);
        if (previous) {
            b.triangle(previous[0], previous[1], left);
            b.triangle(previous[1], right, left);
        }
        previous = [left, right];
    }
}

function makeScrubGeometry() {
    const b = new GeometryBuilder();
    addCylinder(b, 0, 0, 0, 0.095, 0.055, 0.74, 7, [0.105, 0.067, 0.027], [0.17, 0.10, 0.035]);
    const lobes = [
        [-0.30, 0.51, -0.08, 0.36, 0.42, 0.32],
        [0.24, 0.56, 0.12, 0.40, 0.48, 0.37],
        [-0.04, 0.82, 0.02, 0.39, 0.44, 0.35],
        [0.03, 0.43, 0.34, 0.32, 0.35, 0.33],
    ];
    for (let i = 0; i < lobes.length; i++) {
        const l = lobes[i];
        const low = i % 2 ? [0.058, 0.15, 0.032] : [0.079, 0.18, 0.04];
        const high = i % 2 ? [0.13, 0.24, 0.057] : [0.16, 0.27, 0.067];
        addEllipsoid(b, l[0], l[1], l[2], l[3], l[4], l[5], 7, 4, low, high);
    }
    return b.finish("coastal scrub");
}

function makePineGeometry() {
    const b = new GeometryBuilder();
    addCylinder(b, 0, 0, 0, 0.13, 0.035, 4.8, 7, [0.105, 0.055, 0.025], [0.14, 0.07, 0.028]);
    const tiers = [
        [1.28, 2.05, 1.18, 0.43, -0.16],
        [2.14, 1.77, 0.93, 0.48, 0.13],
        [2.95, 1.53, 0.71, 0.44, -0.11],
        [3.68, 1.24, 0.47, 0.43, 0.08],
    ];
    for (let i = 0; i < tiers.length; i++) {
        const t = tiers[i];
        const base = i % 2 ? [0.05, 0.16, 0.051] : [0.061, 0.19, 0.063];
        const tip = i % 2 ? [0.11, 0.25, 0.077] : [0.135, 0.28, 0.09];
        addCanopyTier(b, t[4], t[0], t[2], t[1], t[3], 8, base, tip);
    }
    return b.finish("wind shaped coastal pine");
}

function addCylinder(b, x, z, y0, r0, r1, height, sides, bottomColor, topColor) {
    const lower = [];
    const upper = [];
    for (let i = 0; i < sides; i++) {
        const a = (i / sides) * PI2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const blend = i / (sides - 1);
        const color = [
            bottomColor[0] * (1 - blend) + topColor[0] * blend,
            bottomColor[1] * (1 - blend) + topColor[1] * blend,
            bottomColor[2] * (1 - blend) + topColor[2] * blend,
        ];
        lower.push(b.vertex(x + ca * r0, y0, z + sa * r0, bottomColor));
        upper.push(b.vertex(x + ca * r1, y0 + height, z + sa * r1, color));
    }
    for (let i = 0; i < sides; i++) {
        const j = (i + 1) % sides;
        b.triangle(lower[i], lower[j], upper[i]);
        b.triangle(lower[j], upper[j], upper[i]);
    }
}

function addEllipsoid(b, cx, cy, cz, rx, ry, rz, sides, rings, low, high) {
    const rows = [];
    for (let r = 0; r <= rings; r++) {
        const v = r / rings;
        const phi = -Math.PI * 0.5 + v * Math.PI;
        const cp = Math.cos(phi), sp = Math.sin(phi);
        const row = [];
        for (let i = 0; i < sides; i++) {
            const a = (i / sides) * PI2;
            const shade = 0.83 + 0.24 * Math.max(0, Math.cos(a - 0.8));
            const color = [
                (low[0] * (1 - v) + high[0] * v) * shade,
                (low[1] * (1 - v) + high[1] * v) * shade,
                (low[2] * (1 - v) + high[2] * v) * shade,
            ];
            row.push(b.vertex(cx + Math.cos(a) * cp * rx, cy + sp * ry, cz + Math.sin(a) * cp * rz, color));
        }
        rows.push(row);
    }
    for (let r = 0; r < rings; r++) {
        for (let i = 0; i < sides; i++) {
            const j = (i + 1) % sides;
            b.triangle(rows[r][i], rows[r][j], rows[r + 1][i]);
            b.triangle(rows[r][j], rows[r + 1][j], rows[r + 1][i]);
        }
    }
}

function addCanopyTier(b, x, baseY, radius, height, lean, sides, baseColor, tipColor) {
    const lower = [];
    const middle = [];
    const tip = b.vertex(x + lean, baseY + height, 0, tipColor);
    const midY = baseY + height * 0.55;
    for (let i = 0; i < sides; i++) {
        const a = (i / sides) * PI2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const tint = 0.86 + 0.28 * (0.5 + 0.5 * ca);
        lower.push(b.vertex(x + ca * radius, baseY, sa * radius * 0.82, baseColor));
        middle.push(b.vertex(x + ca * radius * 0.62 + lean * 0.5, midY, sa * radius * 0.52,
            [tipColor[0] * tint, tipColor[1] * tint, tipColor[2] * tint]));
    }
    for (let i = 0; i < sides; i++) {
        const j = (i + 1) % sides;
        b.triangle(lower[i], lower[j], middle[i]);
        b.triangle(lower[j], middle[j], middle[i]);
        b.triangle(middle[i], middle[j], tip);
    }
}
