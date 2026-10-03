#version 300 es
precision highp float;
precision highp int;
#include<surferFlowSelection>

in vec3 position;
uniform mat4 viewProjection;
uniform vec3 cameraPos;
uniform vec3 cameraForward;
uniform vec2 oceanFocus;
uniform float oceanTime;
uniform float baseSpacing;
uniform float gridHalfN;
uniform float shorelineZ;
uniform float coastlineVariation;
uniform float waterLevel;
uniform float waveHeightScale;
uniform float waveSpeedScale;
out vec3 vWorld;
out vec3 vNormal;
out float vViewDist;
out float vViewZ;
out float vSpacing;
#include<coastProfile>

// Camera-following nested ocean clipmap. Vertex positions encode a grid point
// and LOD level; this stage snaps/morphs the rings and applies broad waves.


const float PI = 3.14159265359;

struct WaveField {
    float height;
    vec2 slope;
};

WaveField addWave(vec2 p, float time, float spacing, vec2 direction, float wavelength, float amplitude, float speed) {
    vec2 d = normalize(direction);
    float lodFade = 1.0 - smoothstep(wavelength * 0.16, wavelength * 0.52, spacing);
    float k = 2.0 * PI / wavelength;
    float phase = k * dot(d, p) - speed * waveSpeedScale * time;
    float scaledAmplitude = amplitude * waveHeightScale * lodFade;
    float h = scaledAmplitude * sin(phase);
    vec2 slope = d * (scaledAmplitude * k * cos(phase));
    return WaveField(h, slope);
}

vec3 placeOceanVertex(vec2 grid, float level) {
    float spacing = baseSpacing * exp2(level);
    float snap = spacing * 2.0;
    vec2 ringOrigin = floor(oceanFocus / snap) * snap;
    vec2 local = grid * spacing;

    // Morph toward the next coarser lattice before the ring edge. Neighboring
    // rings overlap by a few cells, avoiding cracks as their origins resnap.
    float extent = gridHalfN * spacing;
    float cheb = max(abs(local.x), abs(local.y)) / max(extent, 1e-5);
    float morph = clamp((cheb - 0.70) / 0.16, 0.0, 1.0);
    vec2 coarseGrid = floor(grid * 0.5) * 2.0;
    vec2 coarseLocal = coarseGrid * spacing;
    local = mix(local, coarseLocal, morph);

    return vec3(ringOrigin.x + local.x, spacing * (1.0 + morph), ringOrigin.y + local.y);
}


void main() {
    float level = position.y;
    vec3 placed = placeOceanVertex(vec2(position.x, position.z), level);
    vec2 worldXZ = vec2(placed.x, placed.z);
    float spacing = placed.y;

    // Dominant swell and two smaller, slightly fanned components travel toward
    // -Z, so they visibly approach the fixed +Z ocean shoreline.
    WaveField w0 = addWave(worldXZ, oceanTime, spacing, vec2(0.0, -1.0), 58.0, 0.72, 3.5);
    WaveField w1 = addWave(worldXZ, oceanTime, spacing, vec2(0.12, -1.0), 27.0, 0.26, 2.65);
    WaveField w2 = addWave(worldXZ, oceanTime, spacing, vec2(-0.10, -1.0), 11.0, 0.07, 1.9);
    WaveField w3 = addWave(worldXZ, oceanTime, spacing, vec2(0.50, -1.0), 92.0, 0.18, 1.15);
    WaveField w4 = addWave(worldXZ, oceanTime, spacing, vec2(-0.38, -1.0), 38.0, 0.10, 1.65);
    float rawHeight = w0.height + w1.height + w2.height + w3.height + w4.height;
    float shoreline = coastShorelineZ(worldXZ.x, shorelineZ, coastlineVariation);
    float shoreT = clamp((worldXZ.y - shoreline) / 6.0, 0.0, 1.0);
    float shoreBlend = shoreT * shoreT * (3.0 - 2.0 * shoreT);
    float height = rawHeight * shoreBlend;
    vec2 slope = (w0.slope + w1.slope + w2.slope + w3.slope + w4.slope) * shoreBlend;
    // Include the derivative of the shoreline fade so the lighting normal
    // follows the same tapered surface that the vertex stage actually draws.
    float shoreGradient = rawHeight * shoreT * (1.0 - shoreT);
    slope.x -= shoreGradient * coastShorelineSlope(worldXZ.x, coastlineVariation);
    slope.y += shoreGradient;
    vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));
    vec3 world = vec3(worldXZ.x, waterLevel + height, worldXZ.y);

    vWorld = world;
    vNormal = normal;
    vViewDist = distance(world, cameraPos);
    vSpacing = spacing;
    vec4 clip = viewProjection * vec4(world, 1.0);
    vViewZ = dot(world - cameraPos, cameraForward);
    gl_Position = clip;
}
