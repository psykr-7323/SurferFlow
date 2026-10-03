#version 300 es
precision highp float;
precision highp int;
#include<surferFlowSelection>

in vec3 position;
uniform mat4 viewProjection;
uniform vec4 panelParams[6];
uniform sampler2D charTex;
out float vViewZ;
out float vMask;
// Depth-prepass vertex shader for the garments. Same Catmull-Rom reconstruction
// over the simulated node grid as cloth.vertex.glsl, from the same include.

#include<surferFlowCharSkin>

   // (u, v, panel index)


void main() {
    vec4 pp = panelParams[int(position.z)];
    ClothSample s = sampleCloth(charTex, int(pp.x), int(pp.y), int(pp.z), position.x, position.y);
    vec4 clip = viewProjection * vec4(s.pos, 1.0);
    vViewZ = clip.w;
    vMask = 0.0;
    gl_Position = clip;
}
