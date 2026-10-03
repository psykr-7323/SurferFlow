#version 300 es
precision highp float;
precision highp int;
#include<surferFlowSelection>

in vec3 position;
in vec3 normal;
in vec2 uv;
in vec2 aux;
in vec4 boneIdx;
in vec4 boneWt;
uniform mat4 viewProjection;
uniform vec3 cameraPos;
uniform sampler2D charTex;
out vec3 vWorld;
out vec3 vNormal;
out vec2 vUV;
out vec2 vAux;
out float vViewDist;
// The body: linear blend skinning straight out of the transform texture.

#include<surferFlowCharSkin>

   // bind-pose world position
     // bind-pose world normal
         // weave coordinates
        // (material id, baked occlusion)


void main() {
    vec3 world = skinPoint(charTex, boneIdx, boneWt, position);
    vec3 n = skinNormal(charTex, boneIdx, boneWt, normal);

    vWorld = world;
    vNormal = n;
    vUV = uv;
    vAux = aux;
    vViewDist = distance(world, cameraPos);
    gl_Position = viewProjection * vec4(world, 1.0);
}
