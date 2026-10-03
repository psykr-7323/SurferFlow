// -----------------------------------------------------------------------------
// coastProfile — canonical coastal base height.
//
// World convention: X runs along the shore, Z crosses it. The shoreline meanders
// along X; the ocean side is at mean sea level and the land side rises inland.
// The profile remains deterministic at any alongshore distance and has no finite
// terrain boundary.
//
// Keep the constants and arithmetic in sync with `coastHeight` in
// `src/terrain/heightfield.js`. CPU height queries return this base profile;
// fine material detail and local deformation remain separate layers.
// -----------------------------------------------------------------------------

const COAST_SHORELINE_Z: f32 = 0.0;

/// Broad coves plus smaller shore bends, keyed to absolute world X. The CPU
/// mirror lives in `src/terrain/heightfield.js` so grounding and rendering agree.
fn coastShorelineOffset(alongshoreX: f32, variationScale: f32) -> f32 {
    return clamp(variationScale, 0.0, 2.0) * (
        10.0 * sin(alongshoreX * 0.0041 + 0.2)
        + 2.5 * sin(alongshoreX * 0.0149 - 0.8)
        + 0.45 * sin(alongshoreX * 0.043 + 1.9)
    );
}

fn coastShorelineSlope(alongshoreX: f32, variationScale: f32) -> f32 {
    let scale = clamp(variationScale, 0.0, 2.0);
    return scale * (
        10.0 * 0.0041 * cos(alongshoreX * 0.0041 + 0.2)
        + 2.5 * 0.0149 * cos(alongshoreX * 0.0149 - 0.8)
        + 0.45 * 0.043 * cos(alongshoreX * 0.043 + 1.9)
    );
}

fn coastShorelineZ(alongshoreX: f32, baseZ: f32, variationScale: f32) -> f32 {
    return baseZ + COAST_SHORELINE_Z
        + coastShorelineOffset(alongshoreX, variationScale);
}

fn coastSmooth01(x: f32) -> f32 {
    let t = clamp(x, 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

// Shared by the ocean and wet sand: the same wave front crosses the shoreline.
fn coastRunup(x: f32, time: f32) -> f32 {
    return 0.35 + 2.65 * (0.5 + 0.5 * sin(time * 0.88 + x * 0.034))
        + 0.22 * sin(x * 0.19 - time * 0.41);
}

fn coastFoamHash(p: vec2f) -> f32 {
    return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

fn coastFoamNoise(p: vec2f) -> f32 {
    let cell = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(coastFoamHash(cell), coastFoamHash(cell + vec2f(1.0, 0.0)), u.x),
        mix(coastFoamHash(cell + vec2f(0.0, 1.0)), coastFoamHash(cell + vec2f(1.0)), u.x), u.y
    );
}

fn coastSwashFoam(p: vec2f, shoreDistance: f32, time: f32, footprint: f32) -> f32 {
    if (shoreDistance > 7.0 || shoreDistance < -4.0) { return 0.0; }
    let front = -coastRunup(p.x, time);
    let frontDistance = abs(shoreDistance - front);
    let foamP = p + vec2f(time * 0.08, -time * 0.12);
    let lace = coastFoamNoise(foamP * 1.6) * 0.72
        + coastFoamNoise(foamP * 3.9) * 0.28;
    let edge = 1.0 - smoothstep(0.16, 0.72 + footprint, frontDistance);
    let trail = smoothstep(front - 0.10, front + 0.4, shoreDistance)
        * (1.0 - smoothstep(0.4, 5.0, shoreDistance));
    return clamp(edge * (0.60 + lace * 0.40)
        + trail * mix(0.25, smoothstep(0.42, 0.78, lace),
            1.0 - smoothstep(0.08, 0.40, footprint)) * 0.35, 0.0, 1.0);
}

fn coastHeight(p: vec2f, baseZ: f32, variationScale: f32) -> f32 {
    let shoreline = coastShorelineZ(p.x, baseZ, variationScale);
    let inland = shoreline - p.y;
    if (inland <= 0.0) {
        return 0.0;
    }
    let beachT = coastSmooth01(inland / 32.0);
    let beach = 0.8 * beachT;

    let inlandGate = coastSmooth01((inland - 32.0) / 24.0);
    let inlandDistance = max(0.0, inland - 32.0);
    let rise = 16.0 * (1.0 - exp(-inlandDistance / 420.0));
    return beach + rise * inlandGate;
}
