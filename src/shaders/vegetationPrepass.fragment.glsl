#version 300 es
precision highp float;
precision highp int;
layout(location = 0) out vec4 fragColor;
#include<surferFlowSelection>

in float vViewZ;
in float vMask;
in float vEdgeFade;
in vec3 vWorld;
in float vShorelineZ;


void main() {
    if(vWorld.z >= vShorelineZ - 5.0 || vEdgeFade < 0.01) { discard; }
    fragColor = vec4(vViewZ, vMask, 0.0, 1.0);
}
