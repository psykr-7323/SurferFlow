/**
 * Coastal base height source.
 *
 * `coastHeight(x, z)` is the canonical gameplay query and is unbounded along
 * the shoreline: +Z is mean-sea-level water (height 0), -Z is a gently rising
 * beach and land. `src/shaders/lib/coast.wgsl` is its render-side equivalent.
 *
 * The render passes and gameplay all evaluate the same low-frequency profile.
 * Fine sand detail belongs in material shading, while animated waves stay in
 * the ocean surface so character grounding remains stable at mean sea level.
 */

import { Vector3 } from "@babylonjs/core/Maths/math.vector";

const BEACH_WIDTH = 32;
const BEACH_HEIGHT = 0.8;
const INLAND_RELIEF = 16;
const INLAND_SCALE = 420;
const INLAND_RAMP = 24;

/**
 * Alongshore shoreline displacement in metres. Keep in sync with
 * `coastShorelineOffset` in `src/shaders/lib/coast.wgsl`.
 */
export function coastShorelineOffset(x, variationScale = 1) {
    const scale = clamp(variationScale, 0, 2);
    return scale * (
        10.0 * Math.sin(x * 0.0041 + 0.2)
        + 2.5 * Math.sin(x * 0.0149 - 0.8)
        + 0.45 * Math.sin(x * 0.043 + 1.9)
    );
}

/** Absolute shoreline Z for an alongshore world coordinate. */
export function coastShorelineAt(x, baseZ = 0, variationScale = 1) {
    return baseZ + coastShorelineOffset(x, variationScale);
}

/**
 * Deterministic coastal ground height in metres relative to mean sea level.
 * Positive Z is ocean; land rises inland from a broad, gently varying coast.
 * The same constants and arithmetic are mirrored by `coastHeight` in
 * `src/shaders/lib/coast.wgsl`.
 *
 * @param {number} x alongshore world coordinate in metres
 * @param {number} z cross-shore world coordinate in metres
 */
export function coastHeight(x, z, baseZ = 0, variationScale = 1) {
    const inland = coastShorelineAt(x, baseZ, variationScale) - z;
    if (inland <= 0) return 0;
    const beachT = clamp01(inland / BEACH_WIDTH);
    const beach = BEACH_HEIGHT * beachT * beachT * (3 - 2 * beachT);

    const inlandT = clamp01((inland - BEACH_WIDTH) / INLAND_RAMP);
    const inlandGate = inlandT * inlandT * (3 - 2 * inlandT);
    const inlandDistance = Math.max(0, inland - BEACH_WIDTH);
    const rise = INLAND_RELIEF * (1 - Math.exp(-inlandDistance / INLAND_SCALE));
    return beach + rise * inlandGate;
}

export class Heightfield {
    constructor(shorelineZ = 0) {
        this.texelWorld = 0.5;
        this.shorelineZ = Number.isFinite(shorelineZ) ? shorelineZ : 0;

        /** Conservative coastal bounds used to fit the shadow cascades. */
        this.minHeight = 0;
        this.maxHeight = BEACH_HEIGHT + INLAND_RELIEF;

    }

    /**
     * Unbounded analytic base height, matching `coastHeight` in WGSL.
     * @param {number} x @param {number} z
     */
    heightAt(x, z, variationScale = 1) {
        return coastHeight(x, z, this.shorelineZ, variationScale);
    }

    /**
     * Surface normal from the analytic profile, by central difference.
     * @param {number} x @param {number} z @param {Vector3} out
     */
    normalAt(x, z, out, variationScale = 1) {
        const e = this.texelWorld;
        const hx = this.heightAt(x + e, z, variationScale) - this.heightAt(x - e, z, variationScale);
        const hz = this.heightAt(x, z + e, variationScale) - this.heightAt(x, z - e, variationScale);
        out.set(-hx / (2 * e), 1, -hz / (2 * e));
        out.normalize();
        return out;
    }

    dispose() {}
}

function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}
