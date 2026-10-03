#version 300 es
precision highp float;
precision highp int;
#include<surferFlowSelection>

in vec3 position;
uniform mat4 viewProjection;
uniform float wakeCount;
uniform float wakeCols;
uniform float wakeRows;
uniform float wakeTime;
uniform sampler2D wakeTex;
out float vQ;
out float vAlong;
out float vAge;
out float vTime;
out float vViewZ;
// Depth-prepass vertex shader for the surf wake. Same `wakePoint` as the beauty
// pass and the shadow pass, and the fragment stage discards the same eroded
// texels — a wall that is half powder must not occlude as if it were solid.

#include<surferFlowNoise>
#include<surferFlowWake>

   // (column, row, side)


void main() {
    float side = position.z;
    float u = position.x / max(wakeCols - 1.0, 1.0);
    float q = position.y / max(wakeRows - 1.0, 1.0);

    vec3 P = wakePoint(wakeTex, wakeCount, u, q, side, wakeTime);
    vec4 sc = wakeScalars(wakeTex, wakeCount, u, side);

    vec4 clip = viewProjection * vec4(P, 1.0);

    vQ = q;
    vAlong = sc.z;
    vAge = sc.w;
    vTime = wakeTime;
    vViewZ = clip.w;
    gl_Position = clip;
}
