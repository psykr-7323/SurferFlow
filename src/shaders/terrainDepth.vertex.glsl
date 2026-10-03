#version 300 es
precision highp float;
precision highp int;
#include<surferFlowSelection>

in vec3 position;
uniform mat4 lightViewProjection;
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
out vec3 vWorld;
// Shadow-pass vertex shader for the terrain.
//
// Critically, this uses the *camera* position to place the clipmap, not the
// light — the geometry rendered into the shadow map must be the identical mesh
// the beauty pass draws, or the depths will not correspond and the terrain will
// acne against its own silhouette. Only the view-projection differs.

#include<coastProfile>
#include<surferFlowDeform>
#include<surferFlowClipmap>


/// Clipmap ring centre — the character, matching terrain.vertex.glsl exactly.


void main() {
    vec2 grid = vec2(position.x, position.z);
    float level = position.y;

    ClipmapVertex cv = placeClipmapVertex(grid, level, lodCenter, baseSpacing, gridHalfN);

    vec2 worldXZ = cv.worldXZ;
    float h = coastHeight(worldXZ, shorelineZ, coastlineVariation);
    // Hidden sea-side terrain stays well below troughs in every geometry pass.
    float seaDistance = worldXZ.y - coastShorelineZ(worldXZ.x, shorelineZ, coastlineVariation);
    h -= 12.0 * smoothstep(0.0, 4.0, seaDistance);

    // Carved snow must cast and receive its own shadow, so the depth pass has to
    // see the deformation too. A trail that does not self-shadow reads as a
    // decal painted on flat ground.
    //
    // This gate, the fade and the filter width have to match terrain.vertex.glsl
    // exactly. If this pass displaced on a ring the beauty pass left flat — or
    // band-limited it differently — the terrain would shadow against a surface
    // that is not the one being drawn, and every berm would acne.
    if(cv.spacing < 1.0) {
        float dfade = 1.0 - smoothstep(0.5, 1.0, cv.spacing);
        h += deformHeight(deformTex, worldXZ, deformCenter, deformSize, deformDepthScale, cv.spacing) * dfade;
    }

    vec3 world = vec3(worldXZ.x, h, worldXZ.y);
    vWorld = world;
    gl_Position = lightViewProjection * vec4(world, 1.0);
}
