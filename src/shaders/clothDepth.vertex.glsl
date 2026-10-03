#version 300 es
precision highp float;
precision highp int;
#include<surferFlowSelection>

in vec3 position;
uniform mat4 lightViewProjection;
uniform vec4 panelParams[6];
uniform sampler2D charTex;
// Shadow-pass vertex shader for the garments.
//
// Same Catmull-Rom reconstruction as cloth.vertex.glsl, from the same include.
// A robe that casts the shape of its bind pose while drawing the shape of its
// simulation is worse than no shadow at all.

#include<surferFlowCharSkin>

   // (u, v, panel index)


void main() {
    vec4 pp = panelParams[int(position.z)];
    ClothSample s = sampleCloth(charTex, int(pp.x), int(pp.y), int(pp.z), position.x, position.y);
    gl_Position = lightViewProjection * vec4(s.pos, 1.0);
}
