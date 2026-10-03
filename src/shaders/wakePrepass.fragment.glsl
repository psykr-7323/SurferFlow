#version 300 es
precision highp float;
precision highp int;
layout(location = 0) out vec4 fragColor;
#include<surferFlowSelection>

in float vQ;
in float vAlong;
in float vAge;
in float vTime;
in float vViewZ;
// Depth prepass for the surf wake — the same erosion the beauty pass applies.

#include<surferFlowNoise>
#include<surferFlowWake>


void main() {
    if(wakeEroded(vAlong, vQ, vAge, vTime)) { discard; }
    fragColor = vec4(vViewZ, 0.0, 0.0, 1.0);
}
