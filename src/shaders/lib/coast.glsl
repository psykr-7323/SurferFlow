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

const float COAST_SHORELINE_Z = 0.0;

/// Broad coves plus smaller shore bends, keyed to absolute world X. The CPU
/// mirror lives in `src/terrain/heightfield.js` so grounding and rendering agree.
float coastShorelineOffset(float alongshoreX, float variationScale) {
    return clamp(variationScale, 0.0, 2.0) * (
        10.0 * sin(alongshoreX * 0.0041 + 0.2)
        + 2.5 * sin(alongshoreX * 0.0149 - 0.8)
        + 0.45 * sin(alongshoreX * 0.043 + 1.9)
    );
}

float coastShorelineSlope(float alongshoreX, float variationScale) {
    float scale = clamp(variationScale, 0.0, 2.0);
    return scale * (
        10.0 * 0.0041 * cos(alongshoreX * 0.0041 + 0.2)
        + 2.5 * 0.0149 * cos(alongshoreX * 0.0149 - 0.8)
        + 0.45 * 0.043 * cos(alongshoreX * 0.043 + 1.9)
    );
}

float coastShorelineZ(float alongshoreX, float baseZ, float variationScale) {
    return baseZ + COAST_SHORELINE_Z
        + coastShorelineOffset(alongshoreX, variationScale);
}

float coastSmooth01(float x) {
    float t = clamp(x, 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

// Shared by the ocean and wet sand: the same wave front crosses the shoreline.
float coastRunup(float x, float time) {
    return 0.35 + 2.65 * (0.5 + 0.5 * sin(time * 0.88 + x * 0.034))
        + 0.22 * sin(x * 0.19 - time * 0.41);
}

float coastFoamHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float coastFoamNoise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(coastFoamHash(cell), coastFoamHash(cell + vec2(1.0, 0.0)), u.x), mix(coastFoamHash(cell + vec2(0.0, 1.0)), coastFoamHash(cell + vec2(1.0)), u.x), u.y);
}

float coastSwashFoam(vec2 p, float shoreDistance, float time, float footprint) {
    if(shoreDistance > 7.0 || shoreDistance < -4.0) { return 0.0; }
    float front = -coastRunup(p.x, time);
    float frontDistance = abs(shoreDistance - front);
    vec2 foamP = p + vec2(time * 0.08, -time * 0.12);
    float lace = coastFoamNoise(foamP * 1.6) * 0.72
        + coastFoamNoise(foamP * 3.9) * 0.28;
    float edge = 1.0 - smoothstep(0.16, 0.72 + footprint, frontDistance);
    float trail = smoothstep(front - 0.10, front + 0.4, shoreDistance)
        * (1.0 - smoothstep(0.4, 5.0, shoreDistance));
    return clamp(edge * (0.60 + lace * 0.40)
        + trail * mix(0.25, smoothstep(0.42, 0.78, lace), 1.0 - smoothstep(0.08, 0.40, footprint)) * 0.35, 0.0, 1.0);
}

float coastHeight(vec2 p, float baseZ, float variationScale) {
    float shoreline = coastShorelineZ(p.x, baseZ, variationScale);
    float inland = shoreline - p.y;
    if(inland <= 0.0) {
        return 0.0;
    }
    float beachT = coastSmooth01(inland / 32.0);
    float beach = 0.8 * beachT;

    float inlandGate = coastSmooth01((inland - 32.0) / 24.0);
    float inlandDistance = max(0.0, inland - 32.0);
    float rise = 16.0 * (1.0 - exp(-inlandDistance / 420.0));
    return beach + rise * inlandGate;
}
