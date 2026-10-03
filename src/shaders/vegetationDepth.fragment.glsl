#version 300 es
precision highp float;
precision highp int;
layout(location = 0) out vec4 fragColor;
#include<surferFlowSelection>

in vec3 vWorld;
in float vEdgeFade;
in float vShorelineZ;


void main() {
    if(vWorld.z >= vShorelineZ - 5.0 || vEdgeFade < 0.01) { discard; }
    fragColor = vec4(gl_FragCoord.z, 0.0, 0.0, 1.0);
}
