#version 300 es
precision highp float;
precision highp int;
#include<surferFlowSelection>

in vec3 position;
in vec4 boneIdx;
in vec4 boneWt;
uniform mat4 lightViewProjection;
uniform sampler2D charTex;
// Shadow-pass vertex shader for the skinned body.
//
// Runs the identical skinning path as char.vertex.glsl through the shared
// include, so the surface in the depth map is the surface being drawn. The only
// difference is which matrix it is projected by.

#include<surferFlowCharSkin>


void main() {
    vec3 world = skinPoint(charTex, boneIdx, boneWt, position);
    gl_Position = lightViewProjection * vec4(world, 1.0);
}
