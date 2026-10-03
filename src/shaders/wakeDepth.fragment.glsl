#version 300 es
precision highp float;
precision highp int;
layout(location = 0) out vec4 fragColor;
#include<surferFlowSelection>

in float vQ;
in float vAlong;
in float vAge;
in float vTime;
// Depth for the surf wake — the same erosion the beauty pass applies, so the
// depth map holds the eroded crest rather than the solid sheet underneath it.

#include<surferFlowNoise>
#include<surferFlowWake>


void main() {
    if(wakeEroded(vAlong, vQ, vAge, vTime)) { discard; }
    fragColor = vec4(gl_FragCoord.z, 0.0, 0.0, 1.0);
}
