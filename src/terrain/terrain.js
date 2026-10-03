/**
 * Terrain system: owns the unbounded coastal profile, player-centred clipmap,
 * sand material and matching shadow/depth-pass materials.
 *
 * Per frame this uploads a handful of uniforms and nothing else. No geometry is
 * rebuilt, no buffer is re-uploaded, nothing is allocated.
 */

import { Vector2, Vector3, Vector4 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";

import { Heightfield, coastShorelineOffset } from "./heightfield.js";
import { DeformationField } from "./deformation.js";
import {
    buildClipmapMesh,
    BASE_SPACING,
    GRID_HALF_N,
    OUTER_EXTENT,
} from "./clipmapMesh.js";
import { S } from "../core/settings.js";
import { CASCADE_COUNT } from "../render/shadows.js";
import { whenReady, bindMatrixArray } from "../core/gpuUtil.js";

const _splits = new Vector4(0, 0, 0, 0);
const _lod = new Vector2();

export class Terrain {
    /**
     * @param {import("@babylonjs/core/scene").Scene} scene
     * @param {import("../render/sky.js").Sky} sky
     * @param {import("../render/shadows.js").ShadowSystem} shadows
     */
    constructor(scene, sky, shadows, options = {}) {
        this.scene = scene;
        this.sky = sky;
        this.shadows = shadows;

        this.heightfield = new Heightfield(options.shorelineZ);

        /** The terrain state buffer. Feet, the surf wake and every spell write here. */
        this.deform = new DeformationField(scene);

        this.mesh = buildClipmapMesh(scene);

        this.material = this._makeCoastMaterial();
        this.mesh.material = this.material;

        // One depth material per cascade, so each can carry its own matrix
        // without any mid-frame uniform-buffer swapping.
        shadows.registerCaster(this.mesh, (c) => this._makeDepthMaterial(c));

        this.setDeformTexture(this.deform.texture);
    }

    _makeCoastMaterial() {
        const mat = new ShaderMaterial(
            "coast",
            this.scene,
            { vertex: "surferFlow", fragment: "coast" },
            {
                attributes: ["position"],
                uniforms: [
                    "viewProjection", "cameraPos", "lodCenter",
                    "baseSpacing", "gridHalfN", "shorelineZ", "coastlineVariation",
                    "sunDir", "sunRadiance",
                    "shR",
                    "cascadeMatrices", "cascadeSplits", "cascadeParams",
                    "shadowTexel", "shadowSoftness", "shadowBias",
                    "fogDensity", "fogHeightFalloff", "fogStart", "aerialStrength",
                    "deformCenter", "deformSize", "deformDepthScale",
                    "ambientIntensity", "sandDetailStrength", "wetSandWidth", "oceanTime", "shoreFoamStrength",
                ],
                samplers: [
                    "skyLUT", "cascade0", "cascade1", "cascade2", "deformTex",
                ],
                shaderLanguage: ShaderLanguage.GLSL,
            }
        );

        mat.backFaceCulling = true;
        mat.setTexture("skyLUT", this.sky.lut);
        for (let i = 0; i < CASCADE_COUNT; i++) {
            mat.setTexture("cascade" + i, this.shadows.maps[i]);
        }
        return mat;
    }

    /**
     * The camera-space depth prepass material.
     *
     * Same clipmap and deformation code as the beauty pass through the same
     * includes; only the fragment stage differs. Registered with the prepass
     * rather than with the shadow system, so it takes `viewProjection` — which
     * Babylon binds from the active camera, and which by then carries this
     * frame's temporal jitter.
     */
    makePrepassMaterial() {
        const mat = new ShaderMaterial(
            "terrainPrepass",
            this.scene,
            { vertex: "terrainPrepass", fragment: "terrainPrepass" },
            {
                attributes: ["position"],
                uniforms: [
                    "viewProjection", "cameraPos", "lodCenter",
                    "baseSpacing", "gridHalfN", "shorelineZ", "coastlineVariation",
                    "deformCenter", "deformSize", "deformDepthScale",
                ],
                samplers: ["deformTex"],
                shaderLanguage: ShaderLanguage.GLSL,
            }
        );
        mat.backFaceCulling = false;
        this.prepassMat = mat;
        return mat;
    }

    _makeDepthMaterial(cascade) {
        const mat = new ShaderMaterial(
            "terrainDepth" + cascade,
            this.scene,
            { vertex: "terrainDepth", fragment: "terrainDepth" },
            {
                attributes: ["position"],
                uniforms: [
                    "lightViewProjection", "cameraPos", "lodCenter",
                    "baseSpacing", "gridHalfN", "shorelineZ", "coastlineVariation",
                    "deformCenter", "deformSize", "deformDepthScale",
                ],
                samplers: ["deformTex"],
                shaderLanguage: ShaderLanguage.GLSL,
                // Forces a distinct Effect per cascade, so each can carry its
                // own light matrix without mid-frame uniform swapping.
                defines: ["SURFERFLOW_CASCADE " + cascade],
            }
        );
        mat.backFaceCulling = false;
        if (!this._depthMats) this._depthMats = [];
        this._depthMats.push(mat);
        return mat;
    }

    async build() {
        // The coast profile is analytic and unbounded, so the cascade depth
        // range can use its conservative land/sea bounds directly.
        this.shadows.setHeightBounds(
            this.heightfield.minHeight - 4,
            this.heightfield.maxHeight + 6
        );
    }

    /**
     * Force every terrain pipeline to compile. Called behind the loading screen
     * so the first rendered frame never pays a compile.
     */
    async warmUp() {
        // Before the snow material, because its first compile binds whatever is
        // in the deformation target and reading uninitialised VRAM as a height
        // can put NaN into a vertex position.
        await this.deform.warmUp();
        this.setDeformTexture(this.deform.texture);

        await whenReady(this.material, "coast material", [this.mesh, false]);
        if (this.prepassMat) {
            await whenReady(this.prepassMat, "terrain prepass", [this.mesh, false]);
        }
        if (this._depthMats) {
            for (let i = 0; i < this._depthMats.length; i++) {
                await whenReady(this._depthMats[i], "terrainDepth" + i, [this.mesh, false]);
            }
        }
    }

    /**
     * Point every terrain pipeline at a deformation target. Called once per
     * ping-pong flip, so all four materials always read the same frame's state.
     * @param {import("@babylonjs/core/Materials/Textures/texture").Texture} tex
     */
    setDeformTexture(tex) {
        this._boundDeform = tex;
        this.material.setTexture("deformTex", tex);
        if (this._depthMats) {
            for (let i = 0; i < this._depthMats.length; i++) {
                this._depthMats[i].setTexture("deformTex", tex);
            }
        }
        if (this.prepassMat) this.prepassMat.setTexture("deformTex", tex);
    }

    /**
     * Advance the terrain state buffer and push this frame's uniforms.
     *
     * The deformation window follows the *player*, not the camera: the camera can
     * be swung right around and the marks the player left have to stay where they
     * were put.
     *
     * @param {Vector3} cameraPos
     * @param {{x:number, z:number}} focus world position the deform window centres on
     * @param {number} dt seconds
     */
    update(cameraPos, focus, dt, oceanTime = 0) {
        const m = this.material;
        m.setFloat("oceanTime", oceanTime * S.oceanWaveSpeed);
        m.setFloat("shoreFoamStrength", S.oceanFoamStrength);

        // Simulate first, then bind: the material must sample the target that
        // was written this frame, not the one from last frame, or every mark
        // lands a frame late and fast movement leaves a visible stagger.
        const deformTex = this.deform.update(dt, focus);
        if (deformTex !== this._boundDeform) {
            this.setDeformTexture(deformTex);
        }
        const deformCenter = this.deform.center;
        const deformSize = this.deform.size;

        // Clipmap rings follow the player, not the viewer — see the note on
        // `lodCenter` in terrain.vertex.glsl. No extra snapping here;
        // `placeClipmapVertex` snaps per ring already.
        _lod.set(focus.x, focus.z);

        m.setVector3("cameraPos", cameraPos);
        m.setVector2("lodCenter", _lod);
        m.setFloat("baseSpacing", BASE_SPACING);
        m.setFloat("gridHalfN", GRID_HALF_N);
        m.setFloat("shorelineZ", this.heightfield.shorelineZ);
        m.setFloat("coastlineVariation", S.coastlineVariation);

        m.setVector3("sunDir", this.sky.sunDir);
        m.setColor3("sunRadiance", this.sky.sunRadiance);
        m.setArray4("shR", this.sky.sh);

        bindMatrixArray(m, "cascadeMatrices", this.shadows.matrixData);
        _splits.set(
            this.shadows.splits[0], this.shadows.splits[1],
            this.shadows.splits[2], this.shadows.splits[3]
        );
        m.setVector4("cascadeSplits", _splits);
        m.setArray4("cascadeParams", this.shadows.paramData);
        m.setFloat("shadowTexel", this.shadows.texelSize);
        m.setFloat("shadowSoftness", 1.8);
        // Metres. Snow has no thin geometry to peter-pan, so this can stay
        // small and keep contact shadows attached.
        m.setFloat("shadowBias", 0.022);

        m.setFloat("fogDensity", S.fogDensity);
        m.setFloat("fogHeightFalloff", S.fogHeightFalloff);
        m.setFloat("fogStart", S.fogStart);
        m.setFloat("aerialStrength", S.aerialStrength);
        m.setFloat("ambientIntensity", S.ambientIntensity);
        m.setFloat("sandDetailStrength", S.sandDetailStrength);
        m.setFloat("wetSandWidth", S.wetSandWidth);

        m.setVector2("deformCenter", deformCenter);
        m.setFloat("deformSize", deformSize);
        m.setFloat("deformDepthScale", S.deformDepth);
        m.wireframe = S.wireframe;

        // ---- depth prepass ----------------------------------------------
        // Same clipmap parameters as everything else, for the same reason.
        const pm = this.prepassMat;
        if (pm) {
            pm.setVector3("cameraPos", cameraPos);
            pm.setVector2("lodCenter", _lod);
            pm.setFloat("baseSpacing", BASE_SPACING);
            pm.setFloat("gridHalfN", GRID_HALF_N);
            pm.setFloat("shorelineZ", this.heightfield.shorelineZ);
            pm.setFloat("coastlineVariation", S.coastlineVariation);
            pm.setVector2("deformCenter", deformCenter);
            pm.setFloat("deformSize", deformSize);
            pm.setFloat("deformDepthScale", S.deformDepth);
        }

        // ---- shadow-pass materials --------------------------------------
        // These must see the identical clipmap parameters, or the depth pass
        // would place vertices somewhere the beauty pass does not.
        const dm = this._depthMats;
        if (dm) {
            for (let i = 0; i < dm.length; i++) {
                const d = dm[i];
                d.setVector3("cameraPos", cameraPos);
                d.setVector2("lodCenter", _lod);
                d.setFloat("baseSpacing", BASE_SPACING);
                d.setFloat("gridHalfN", GRID_HALF_N);
                d.setFloat("shorelineZ", this.heightfield.shorelineZ);
                d.setFloat("coastlineVariation", S.coastlineVariation);
                d.setVector2("deformCenter", deformCenter);
                d.setFloat("deformSize", deformSize);
                d.setFloat("deformDepthScale", S.deformDepth);
            }
        }
    }

    /** @param {number} x @param {number} z */
    heightAt(x, z) {
        return this.heightfield.heightAt(x, z, S.coastlineVariation);
    }

    /** @param {number} x @param {number} z @param {Vector3} out */
    normalAt(x, z, out) {
        return this.heightfield.normalAt(x, z, out, S.coastlineVariation);
    }

    /** @param {number} x */
    shorelineAt(x) {
        return this.heightfield.shorelineZ
            + coastShorelineOffset(x, S.coastlineVariation);
    }

    dispose() {
        this.mesh.dispose();
        this.material.dispose();
        this.deform.dispose();
        this.heightfield.dispose();
    }
}
