#include<coastProfile>

// Camera-following nested ocean clipmap. Vertex positions encode a grid point
// and LOD level; this stage snaps/morphs the rings and applies broad waves.

attribute position: vec3f;

uniform viewProjection: mat4x4f;
uniform cameraPos: vec3f;
uniform cameraForward: vec3f;
uniform oceanFocus: vec2f;
uniform oceanTime: f32;
uniform baseSpacing: f32;
uniform gridHalfN: f32;
uniform shorelineZ: f32;
uniform coastlineVariation: f32;
uniform waterLevel: f32;
uniform waveHeightScale: f32;
uniform waveSpeedScale: f32;

varying vWorld: vec3f;
varying vNormal: vec3f;
varying vViewDist: f32;
varying vViewZ: f32;
varying vSpacing: f32;

const PI: f32 = 3.14159265359;

struct WaveField {
    height: f32,
    slope: vec2f,
};

fn addWave(
    p: vec2f,
    time: f32,
    spacing: f32,
    direction: vec2f,
    wavelength: f32,
    amplitude: f32,
    speed: f32
) -> WaveField {
    let d = normalize(direction);
    let lodFade = 1.0 - smoothstep(wavelength * 0.16, wavelength * 0.52, spacing);
    let k = 2.0 * PI / wavelength;
    let phase = k * dot(d, p) - speed * uniforms.waveSpeedScale * time;
    let scaledAmplitude = amplitude * uniforms.waveHeightScale * lodFade;
    let h = scaledAmplitude * sin(phase);
    let slope = d * (scaledAmplitude * k * cos(phase));
    return WaveField(h, slope);
}

fn placeOceanVertex(grid: vec2f, level: f32) -> vec3f {
    let spacing = uniforms.baseSpacing * exp2(level);
    let snap = spacing * 2.0;
    let ringOrigin = floor(uniforms.oceanFocus / snap) * snap;
    var local = grid * spacing;

    // Morph toward the next coarser lattice before the ring edge. Neighboring
    // rings overlap by a few cells, avoiding cracks as their origins resnap.
    let extent = uniforms.gridHalfN * spacing;
    let cheb = max(abs(local.x), abs(local.y)) / max(extent, 1e-5);
    let morph = clamp((cheb - 0.70) / 0.16, 0.0, 1.0);
    let coarseGrid = floor(grid * 0.5) * 2.0;
    let coarseLocal = coarseGrid * spacing;
    local = mix(local, coarseLocal, morph);

    return vec3f(ringOrigin.x + local.x, spacing * (1.0 + morph), ringOrigin.y + local.y);
}

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    let level = vertexInputs.position.y;
    let placed = placeOceanVertex(
        vec2f(vertexInputs.position.x, vertexInputs.position.z), level
    );
    let worldXZ = vec2f(placed.x, placed.z);
    let spacing = placed.y;

    // Dominant swell and two smaller, slightly fanned components travel toward
    // -Z, so they visibly approach the fixed +Z ocean shoreline.
    let w0 = addWave(worldXZ, uniforms.oceanTime, spacing,
        vec2f(0.0, -1.0), 58.0, 0.72, 3.5);
    let w1 = addWave(worldXZ, uniforms.oceanTime, spacing,
        vec2f(0.12, -1.0), 27.0, 0.26, 2.65);
    let w2 = addWave(worldXZ, uniforms.oceanTime, spacing,
        vec2f(-0.10, -1.0), 11.0, 0.07, 1.9);
    let w3 = addWave(worldXZ, uniforms.oceanTime, spacing,
        vec2f(0.50, -1.0), 92.0, 0.18, 1.15);
    let w4 = addWave(worldXZ, uniforms.oceanTime, spacing,
        vec2f(-0.38, -1.0), 38.0, 0.10, 1.65);
    let rawHeight = w0.height + w1.height + w2.height + w3.height + w4.height;
    let shoreline = coastShorelineZ(
        worldXZ.x, uniforms.shorelineZ, uniforms.coastlineVariation
    );
    let shoreT = clamp((worldXZ.y - shoreline) / 6.0, 0.0, 1.0);
    let shoreBlend = shoreT * shoreT * (3.0 - 2.0 * shoreT);
    let height = rawHeight * shoreBlend;
    var slope = (w0.slope + w1.slope + w2.slope + w3.slope + w4.slope) * shoreBlend;
    // Include the derivative of the shoreline fade so the lighting normal
    // follows the same tapered surface that the vertex stage actually draws.
    let shoreGradient = rawHeight * shoreT * (1.0 - shoreT);
    slope.x -= shoreGradient * coastShorelineSlope(
        worldXZ.x, uniforms.coastlineVariation
    );
    slope.y += shoreGradient;
    let normal = normalize(vec3f(-slope.x, 1.0, -slope.y));
    let world = vec3f(worldXZ.x, uniforms.waterLevel + height, worldXZ.y);

    vertexOutputs.vWorld = world;
    vertexOutputs.vNormal = normal;
    vertexOutputs.vViewDist = distance(world, uniforms.cameraPos);
    vertexOutputs.vSpacing = spacing;
    let clip = uniforms.viewProjection * vec4f(world, 1.0);
    vertexOutputs.vViewZ = dot(world - uniforms.cameraPos, uniforms.cameraForward);
    vertexOutputs.position = clip;
}
