#version 300 es
precision highp float;
precision highp int;
#include<surferFlowSelection>

in vec3 position;
uniform mat4 viewProjection;
uniform vec3 cameraPos;
uniform vec2 lodCenter;
uniform float baseSpacing;
uniform float gridHalfN;
uniform float shorelineZ;
uniform float coastlineVariation;
uniform vec2 deformCenter;
uniform float deformSize;
uniform float deformDepthScale;
uniform sampler2D deformTex;
out float vViewZ;
out float vMask;
out vec3 vWorld;
// Depth-prepass vertex shader for the terrain.
//
// Byte-for-byte the same clipmap placement, the same fine layer and the same
// band-limited deformation as terrain.vertex.glsl and terrainDepth.vertex.glsl,
// from the same includes. If this pass placed a vertex anywhere else, every
// screen-space effect downstream would be integrating against a surface that is
// not the one on screen — and the symptom of that is an ambient-occlusion halo
// that follows the camera, which reads as a rendering bug rather than as a
// mismatch.

#include<coastProfile>
#include<surferFlowDeform>
#include<surferFlowClipmap>


void main() {
    vec2 grid = vec2(position.x, position.z);
    float level = position.y;

    ClipmapVertex cv = placeClipmapVertex(grid, level, lodCenter, baseSpacing, gridHalfN);

    vec2 worldXZ = cv.worldXZ;
    float h = coastHeight(worldXZ, shorelineZ, coastlineVariation);
    // Hidden sea-side terrain stays well below troughs in every geometry pass.
    float seaDistance = worldXZ.y - coastShorelineZ(worldXZ.x, shorelineZ, coastlineVariation);
    h -= 12.0 * smoothstep(0.0, 4.0, seaDistance);

    // Same gate, same fade, same filter width as the beauty pass. See the long
    // note in terrain.vertex.glsl.
    float mask = 0.0;
    if(cv.spacing < 1.0) {
        float dfade = 1.0 - smoothstep(0.5, 1.0, cv.spacing);
        h += deformHeight(deformTex, worldXZ, deformCenter, deformSize, deformDepthScale, cv.spacing) * dfade;
    }

    // The ice channel, read straight rather than through `deformHeight`'s
    // binomial: this feeds a reflection gate, not a displacement, so smoothing it
    // to the vertex lattice would only soften the edge of a glaze that the
    // fragment stage draws hard.
    float dWeight = deformFalloff(worldXZ, deformCenter, deformSize);
    if(dWeight > 0.001) {
        vec4 s = textureLod(deformTex, deformUV(worldXZ, deformSize), 0.0);
        mask = clamp(s.a, 0.0, 1.0) * dWeight;
    }

    vec4 clip = viewProjection * vec4(worldXZ.x, h, worldXZ.y, 1.0);
    vWorld = vec3(worldXZ.x, h, worldXZ.y);
    vViewZ = clip.w;
    vMask = mask;
    gl_Position = clip;
}
