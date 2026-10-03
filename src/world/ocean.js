/**
 * Broad, camera-following ocean surface for the coastal world.
 *
 * This is intentionally independent from the swept water bodies used by spells.
 * The ocean is a continuous, opaque sheet; its clipmap follows the supplied
 * focus point while the shader evaluates waves and shoreline foam in world
 * coordinates. Its default base shoreline is world Z = 0, with a deterministic
 * alongshore meander and water on the +Z side of the local shoreline.
 *
 * Integration:
 *   const ocean = new Ocean(scene, sky);
 *   // Each frame, before rendering:
 *   ocean.update(dt, character.position);
 *
 * `focus` may be a Babylon Vector3 or an {x, z} object. The optional third
 * argument to `update` overrides the active camera position used for lighting
 * and distance fade. The mesh is an opaque depth-writing surface in rendering
 * group 1 by default; land meets it along the shared local shoreline profile.
 */

import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import { ShaderStore } from "@babylonjs/core/Engines/shaderStore";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math";

import { S } from "../core/settings.js";
import { coastShorelineAt } from "../terrain/heightfield.js";
import oceanVertex from "./ocean.vertex.wgsl?glsl";
import oceanFragment from "./ocean.fragment.wgsl?glsl";
import oceanPrepassFragment from "./ocean.prepass.fragment.wgsl?glsl";
import coastProfile from "../shaders/lib/coast.wgsl?glsl";

const DEFAULT_GRID_N = 160;
// Eight rings reach just beyond the camera's 4.2 km far plane at the default
// spacing. The clipmap follows the player, so more rings would add triangles
// without extending visible water.
const DEFAULT_LEVELS = 8;
const DEFAULT_BASE_SPACING = 0.5;
const HOLE_SHRINK = 3;
const _LOCAL_FORWARD = new Vector3(0, 0, 1);
const WAVE_1_LENGTH = Math.hypot(0.12, 1.0);
const WAVE_2_LENGTH = Math.hypot(0.10, 1.0);
const WAVE_DIR_1 = [0.12 / WAVE_1_LENGTH, -1.0 / WAVE_1_LENGTH];
const WAVE_DIR_2 = [-0.10 / WAVE_2_LENGTH, -1.0 / WAVE_2_LENGTH];
const WAVE_DIR_3 = [0.50 / Math.hypot(0.50, 1), -1 / Math.hypot(0.50, 1)];
const WAVE_DIR_4 = [-0.38 / Math.hypot(0.38, 1), -1 / Math.hypot(0.38, 1)];
const WAVE_K_0 = (2 * Math.PI) / 58.0;
const WAVE_K_1 = (2 * Math.PI) / 27.0;
const WAVE_K_2 = (2 * Math.PI) / 11.0;

let registered = false;

function registerOceanShaders() {
    if (registered) return;
    registered = true;
    if (!ShaderStore.IncludesShadersStore.coastProfile) {
        ShaderStore.IncludesShadersStore.coastProfile = coastProfile;
    }
    ShaderStore.ShadersStore.rideOceanVertexShader = oceanVertex;
    ShaderStore.ShadersStore.rideOceanPixelShader = oceanFragment;
    ShaderStore.ShadersStore.rideOceanPrepassPixelShader = oceanPrepassFragment;
}

/**
 * @typedef {Object} OceanOptions
 * @property {number} [shorelineZ=0] Absolute world Z at the sea/land boundary.
 * @property {number} [waterLevel=0] Mean ocean height in world metres.
 * @property {number} [renderingGroupId=1] Opaque render group; group 1 is the
 *   project's existing terrain group.
 * @property {number} [baseSpacing=0.5] Finest clipmap vertex spacing, metres.
 * @property {number} [levels=8] Number of nested clipmap levels.
 * @property {number} [gridN=160] Quads per side per clipmap level.
 * @property {boolean} [enabled=true]
 */

export class Ocean {
    /**
     * @param {import("@babylonjs/core/scene").Scene} scene
     * @param {import("../render/sky.js").Sky} sky The shared analytic sky/LUT.
     * @param {OceanOptions} [options]
     */
    constructor(scene, sky, options = {}) {
        if (!sky?.lut || !sky?.sunDir || !sky?.sunRadiance) {
            throw new Error("Ocean requires the solved scene Sky instance.");
        }

        this.scene = scene;
        this.sky = sky;
        this.time = 0;
        this.shorelineZ = Number.isFinite(options.shorelineZ) ? options.shorelineZ : 0;
        this.waterLevel = Number.isFinite(options.waterLevel) ? options.waterLevel : 0;
        this.baseSpacing = positive(options.baseSpacing, DEFAULT_BASE_SPACING);
        this._surfaceWaveLod = [
            waveLodFade(this.baseSpacing, 58.0),
            waveLodFade(this.baseSpacing, 27.0),
            waveLodFade(this.baseSpacing, 11.0),
            waveLodFade(this.baseSpacing, 92.0),
            waveLodFade(this.baseSpacing, 38.0),
        ];
        this.levels = Math.min(12, integerAtLeast(options.levels, DEFAULT_LEVELS, 1));
        this.gridN = Math.min(256, integerAtLeast(options.gridN, DEFAULT_GRID_N, 16));
        // The ring hole is measured in half-grid units; keeping a multiple of
        // four makes that boundary integral and the index allocation exact.
        this.gridN = Math.max(16, Math.ceil(this.gridN / 4) * 4);

        this.mesh = buildOceanClipmap(scene, this.gridN, this.levels, this.baseSpacing);
        this.mesh.renderingGroupId = Number.isInteger(options.renderingGroupId)
            ? options.renderingGroupId
            : 1;
        this.mesh.isVisible = options.enabled !== false;

        this.material = this._makeMaterial();
        this.mesh.material = this.material;
        /** @type {import("@babylonjs/core/Materials/shaderMaterial").ShaderMaterial|null} */
        this.prepassMaterial = null;

        this._focus = new Vector2();
        this._camera = new Vector3();
        this._forward = new Vector3(0, 0, 1);
        this._wakePosition = new Vector2();
        this._wakeForward = new Vector2(0, 1);
        this._wakeActivity = 0;
        this._wakeSpeed = 0;
        this._pushStaticUniforms();
        this.update(0);
    }

    _makeMaterial() {
        registerOceanShaders();
        const mat = new ShaderMaterial(
            "rideOcean",
            this.scene,
            { vertex: "rideOcean", fragment: "rideOcean" },
            {
                attributes: ["position"],
                uniforms: [
                    "viewProjection", "cameraPos", "oceanFocus", "oceanTime",
                    "baseSpacing", "gridHalfN", "shorelineZ", "coastlineVariation", "waterLevel",
                    "sunDir", "sunRadiance", "cameraForward", "oceanColorSpan", "waveHeightScale",
                    "waveSpeedScale", "shoreFoamStrength", "wakePosition",
                    "wakeForward", "wakeActivity", "wakeSpeed",
                ],
                samplers: ["skyLUT"],
                shaderLanguage: ShaderLanguage.GLSL,
            }
        );
        mat.backFaceCulling = true;
        mat.setTexture("skyLUT", this.sky.lut);
        return mat;
    }

    _pushStaticUniforms(mat = this.material) {
        mat.setFloat("baseSpacing", this.baseSpacing);
        mat.setFloat("gridHalfN", this.gridN * 0.5);
        mat.setFloat("shorelineZ", this.shorelineZ);
        mat.setFloat("waterLevel", this.waterLevel);
    }

    /**
     * Follow a world-space point and advance the wave phase.
     *
     * The rings snap independently in WGSL and morph across their outer edges,
     * so this updates uniforms only: there are no per-frame mesh uploads.
     *
     * @param {number} dt Seconds since the preceding frame.
     * @param {{x:number, z?:number, y?:number}} [focus] Usually player position.
     *   When omitted, the active camera position is used.
     * @param {Vector3} [cameraPosition] Optional camera override for the shader.
     * @param {Vector3} [cameraForward] Optional normalized or unnormalized
     *   world-space camera direction. The active camera supplies it by default.
     * @param {{position:{x:number,z:number},velocity:{x:number,z:number},surf:number,speed:number,facing:number}} [wakeState]
     *   Character state driving the short foam wake behind a moving surfer.
     */
    update(dt, focus, cameraPosition, cameraForward, wakeState) {
        const activeCamera = this.scene.activeCamera;
        const camera = cameraPosition || activeCamera?.globalPosition || activeCamera?.position;
        const anchor = focus || camera || Vector3.Zero();
        const x = Number.isFinite(anchor.x) ? anchor.x : 0;
        const z = Number.isFinite(anchor.z)
            ? anchor.z
            : Number.isFinite(anchor.y) ? anchor.y : 0;

        this._focus.set(x, z);
        if (camera) this._camera.set(camera.x || 0, camera.y || 0, camera.z || 0);
        else this._camera.set(0, 0, 0);

        if (cameraForward) {
            this._forward.copyFrom(cameraForward);
        } else if (typeof activeCamera?.getDirectionToRef === "function") {
            activeCamera.getDirectionToRef(_LOCAL_FORWARD, this._forward);
        } else {
            this._forward.set(0, 0, 1);
        }
        if (this._forward.lengthSquared() > 1e-8) this._forward.normalize();
        else this._forward.set(0, 0, 1);

        if (wakeState?.position) {
            this._wakePosition.set(wakeState.position.x || 0, wakeState.position.z || 0);
            const vx = wakeState.velocity?.x || 0;
            const vz = wakeState.velocity?.z || 0;
            const speed = Number.isFinite(wakeState.speed)
                ? wakeState.speed
                : Math.hypot(vx, vz);
            if (speed > 0.1) this._wakeForward.set(vx / speed, vz / speed);
            else this._wakeForward.set(
                Math.sin(wakeState.facing || 0),
                Math.cos(wakeState.facing || 0)
            );
            this._wakeSpeed = Math.max(0, Number.isFinite(speed) ? speed : 0);
            this._wakeActivity = S.showWake
                ? clamp01(wakeState.surf || 0) * clamp01((this._wakeSpeed - 2.0) / 5.0)
                : 0;
        } else {
            this._wakeActivity = 0;
            this._wakeSpeed = 0;
        }

        this.time += Math.max(0, Number.isFinite(dt) ? dt : 0);

        this._pushFrameUniforms(this.material);
        if (this.prepassMaterial) this._pushFrameUniforms(this.prepassMaterial);
    }

    /**
     * Sample the visible ocean height for render-side grounding. Horizontal
     * locomotion remains on the mean sea plane; the character can follow the
     * same broad swell vertically without bobbing or clipping through opaque
     * wave crests. `time` can be `this.time + dt` before the next update.
     * @param {number} x
     * @param {number} z
     * @param {number} [time=this.time]
    */
    surfaceHeightAt(x, z, time = this.time) {
        const heightScale = this.waveHeightScaleAt(time);
        const speedScale = readScale(S.oceanWaveSpeed);
        let wave = 0;
        wave += sampleWave(
            x, z, time, 0.0, -1.0, WAVE_K_0, this._surfaceWaveLod[0],
            0.72, 3.5, heightScale, speedScale
        );
        wave += sampleWave(
            x, z, time, WAVE_DIR_1[0], WAVE_DIR_1[1], WAVE_K_1, this._surfaceWaveLod[1],
            0.26, 2.65, heightScale, speedScale
        );
        wave += sampleWave(
            x, z, time, WAVE_DIR_2[0], WAVE_DIR_2[1], WAVE_K_2, this._surfaceWaveLod[2],
            0.07, 1.9, heightScale, speedScale
        );
        wave += sampleWave(x, z, time, WAVE_DIR_3[0], WAVE_DIR_3[1],
            2 * Math.PI / 92, this._surfaceWaveLod[3], 0.18, 1.15, heightScale, speedScale);
        wave += sampleWave(x, z, time, WAVE_DIR_4[0], WAVE_DIR_4[1],
            2 * Math.PI / 38, this._surfaceWaveLod[4], 0.10, 1.65, heightScale, speedScale);

        const shoreT = clamp01((z - this.shorelineAt(x)) / 6.0);
        const shoreBlend = shoreT * shoreT * (3 - 2 * shoreT);
        return this.waterLevel + wave * shoreBlend;
    }

    /** Local shoreline Z at the supplied alongshore world coordinate. */
    shorelineAt(x) {
        return coastShorelineAt(x, this.shorelineZ, S.coastlineVariation);
    }

    /** Whether a world position lies on the sea side of the varying coast. */
    isWaterAt(x, z) {
        return z >= this.shorelineAt(x);
    }

    /**
     * Create the matching camera-depth material for registration with
     * `DepthPass.registerCaster(this.mesh, ocean.makePrepassMaterial())`.
     * It evaluates the same clipmap and waves as the beauty material, writes
     * linear view depth to R, and leaves the SSR mask in G at zero.
     *
     * @returns {import("@babylonjs/core/Materials/shaderMaterial").ShaderMaterial}
     */
    makePrepassMaterial() {
        if (this.prepassMaterial) return this.prepassMaterial;
        registerOceanShaders();

        const mat = new ShaderMaterial(
            "rideOceanPrepass",
            this.scene,
            { vertex: "rideOcean", fragment: "rideOceanPrepass" },
            {
                attributes: ["position"],
                uniforms: [
                    "viewProjection", "cameraPos", "cameraForward", "oceanFocus",
                    "oceanTime", "baseSpacing", "gridHalfN", "shorelineZ", "coastlineVariation", "waterLevel",
                    "waveHeightScale", "waveSpeedScale",
                ],
                shaderLanguage: ShaderLanguage.GLSL,
            }
        );
        mat.backFaceCulling = true;
        this.prepassMaterial = mat;
        this._pushStaticUniforms(mat);
        this._pushFrameUniforms(mat);
        return mat;
    }

    /** Shared smooth wave-set envelope for visible water and rider grounding. */
    waveHeightScaleAt(time = this.time) {
        const base = readScale(S.oceanWaveHeight);
        if (!S.oceanWaveSets) return base;
        const interval = Math.max(10, Number(S.oceanWaveSetSeconds) || 30);
        const phase = 2 * Math.PI * time / interval;
        // Gentle water grows into a larger set and settles again every interval.
        return base * (1.10 - 0.55 * Math.cos(phase));
    }

    _pushFrameUniforms(mat) {
        mat.setVector2("oceanFocus", this._focus);
        mat.setVector3("cameraPos", this._camera);
        mat.setVector3("cameraForward", this._forward);
        mat.setFloat("oceanTime", this.time);
        mat.setFloat("waveHeightScale", this.waveHeightScaleAt(this.time));
        mat.setFloat("waveSpeedScale", readScale(S.oceanWaveSpeed));
        mat.setFloat("coastlineVariation", readScale(S.coastlineVariation));
        if (mat === this.material) {
            mat.setVector3("sunDir", this.sky.sunDir);
            mat.setColor3("sunRadiance", this.sky.sunRadiance);
            mat.setFloat("shoreFoamStrength", readScale(S.oceanFoamStrength));
            mat.setFloat("oceanColorSpan", Math.max(1, S.oceanColorSpan));
            mat.setVector2("wakePosition", this._wakePosition);
            mat.setVector2("wakeForward", this._wakeForward);
            mat.setFloat("wakeActivity", this._wakeActivity);
            mat.setFloat("wakeSpeed", this._wakeSpeed);
        }
    }

    /** @param {boolean} enabled */
    setEnabled(enabled) {
        this.mesh.isVisible = !!enabled;
    }

    /** Release the ocean mesh and material. */
    dispose() {
        this.mesh.dispose();
        this.material.dispose();
        this.prepassMaterial?.dispose();
    }
}

/**
 * Static nested square lattice. Positions encode (grid X, LOD level, grid Z);
 * the WGSL vertex stage assigns world coordinates every frame.
 * @param {import("@babylonjs/core/scene").Scene} scene
 * @param {number} gridN
 * @param {number} levels
 * @param {number} baseSpacing
 */
function buildOceanClipmap(scene, gridN, levels, baseSpacing) {
    const half = gridN >> 1;
    const side = gridN + 1;
    const vertsPerLevel = side * side;
    const holeHalf = Math.max(1, half / 2 - HOLE_SHRINK);
    const holeSide = holeHalf * 2;
    const holeQuads = holeSide * holeSide;
    const quadsPerLevel = gridN * gridN;
    const totalQuads = quadsPerLevel + (levels - 1) * (quadsPerLevel - holeQuads);

    const positions = new Float32Array(vertsPerLevel * levels * 3);
    const indices = new Uint32Array(totalQuads * 6);

    let po = 0;
    let io = 0;
    for (let level = 0; level < levels; level++) {
        const base = level * vertsPerLevel;
        for (let j = 0; j <= gridN; j++) {
            for (let i = 0; i <= gridN; i++) {
                positions[po++] = i - half;
                positions[po++] = level;
                positions[po++] = j - half;
            }
        }

        for (let j = 0; j < gridN; j++) {
            const gz = j - half;
            for (let i = 0; i < gridN; i++) {
                const gx = i - half;
                if (level > 0) {
                    const maxAbs = Math.max(
                        Math.abs(gx), Math.abs(gx + 1),
                        Math.abs(gz), Math.abs(gz + 1)
                    );
                    if (maxAbs <= holeHalf) continue;
                }

                const a = base + j * side + i;
                const b = a + 1;
                const c = a + side;
                const d = c + 1;
                // Babylon's left-handed front-face convention, matching the
                // upward-facing terrain clipmap winding.
                if (((i + j) & 1) === 0) {
                    indices[io++] = a; indices[io++] = b; indices[io++] = c;
                    indices[io++] = b; indices[io++] = d; indices[io++] = c;
                } else {
                    indices[io++] = a; indices[io++] = d; indices[io++] = c;
                    indices[io++] = a; indices[io++] = b; indices[io++] = d;
                }
            }
        }
    }

    const mesh = new Mesh("ocean", scene);
    const vertexData = new VertexData();
    vertexData.positions = positions;
    vertexData.indices = io === indices.length ? indices : indices.subarray(0, io);
    vertexData.applyToMesh(mesh, false);

    mesh.alwaysSelectAsActiveMesh = true;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    mesh.doNotSyncBoundingInfo = true;
    mesh.metadata = {
        triangles: io / 3,
        vertices: vertsPerLevel * levels,
        outerHalfExtent: baseSpacing * half * Math.pow(2, levels - 1),
    };
    return mesh;
}

function positive(value, fallback) {
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

function integerAtLeast(value, fallback, min) {
    return Number.isFinite(value) ? Math.max(min, Math.floor(value)) : fallback;
}

function clamp01(value) {
    return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function readScale(value) {
    return Number.isFinite(value) ? Math.max(0, value) : 1;
}

function waveLodFade(spacing, wavelength) {
    const t = clamp01((spacing - wavelength * 0.16) / (wavelength * 0.36));
    return 1 - t * t * (3 - 2 * t);
}

function sampleWave(x, z, time, dirX, dirZ, k, lodFade, amplitude, speed, heightScale, speedScale) {
    const phase = k * (dirX * x + dirZ * z)
        - speed * speedScale * time;
    return amplitude * heightScale * lodFade * Math.sin(phase);
}
