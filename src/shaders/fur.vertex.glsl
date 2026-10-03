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
uniform vec3 furDroop;
uniform sampler2D charTex;
out vec3 vWorld;
out vec3 vNormal;
out vec2 vUV;
out vec2 vAux;
out float vViewDist;
// Shell fur.
//
// The shell offset is already baked into the vertex position at build time, so
// all this adds is droop: gravity, wind and the character's own acceleration,
// applied in world space and scaled by the square of the shell parameter. The
// square is what curves a strand instead of shearing it — the tip moves four
// times as far as the midpoint.

#include<surferFlowCharSkin>

   // bind-pose world position, shell offset included
     // shell direction, unit
         // strand field coordinates, in metres of surface
        // (shell parameter 0..1, baked occlusion)


/// World-space displacement applied to a strand tip.


void main() {
    int b = int(boneIdx.x);
    vec3 world = skinPoint1(charTex, b, position);
    vec3 n = normalize(skinDir1(charTex, b, normal));

    float t = aux.x;
    world += furDroop * (t * t);

    vWorld = world;
    vNormal = n;
    vUV = uv;
    vAux = aux;
    vViewDist = distance(world, cameraPos);
    gl_Position = viewProjection * vec4(world, 1.0);
}
