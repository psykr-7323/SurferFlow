#version 300 es
precision highp float;
precision highp int;
layout(location = 0) out vec4 fragColor;
#include<surferFlowSelection>

in vec3 vWorld;
in float vViewZ;
uniform float shorelineZ;
uniform float coastlineVariation;
#include<coastProfile>

// Depth-prepass fragment stage for the ocean. The G channel stays zero so SSR
// continues to ignore the ocean until a water-specific reflection pass exists.


void main() {
    float shoreline = coastShorelineZ(vWorld.x, shorelineZ, coastlineVariation);
    if(vWorld.z < shoreline) { discard; }
    if(vViewZ <= 0.0) { discard; }
    fragColor = vec4(vViewZ, 0.0, 0.0, 1.0);
}
