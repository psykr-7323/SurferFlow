#version 300 es
precision highp float;
precision highp int;
layout(location = 0) out vec4 fragColor;
#include<surferFlowSelection>

in float vViewZ;
in float vMask;
in vec3 vWorld;
uniform float shorelineZ;
uniform float coastlineVariation;
// Terrain-only camera-depth prepass. The sea side of the clipmap is omitted so
// the matching ocean prepass supplies the animated water depth there.

#include<coastProfile>


void main() {
    float shoreline = coastShorelineZ(vWorld.x, shorelineZ, coastlineVariation);
    if(vWorld.z >= shoreline) { discard; }
    fragColor = vec4(vViewZ, vMask, 0.0, 1.0);
}
