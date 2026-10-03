#version 300 es
precision highp float;
precision highp int;
#include<surferFlowSelection>

in vec3 position;
in vec4 world0;
in vec4 world1;
in vec4 world2;
in vec4 world3;
uniform mat4 viewProjection;
uniform mat4 world;
uniform vec2 vegetationFocus;
uniform float vegetationRadius;
uniform float shorelineZ;
uniform float coastlineVariation;
out float vViewZ;
out float vMask;
out float vEdgeFade;
out vec3 vWorld;
out float vShorelineZ;
#include<coastVegetation>
#include<coastProfile>


#ifdef INSTANCES


#endif


void main() {
    mat4 finalWorld = world;
#ifdef INSTANCES
    finalWorld = mat4(world0, world1, world2, world3);
#ifdef THIN_INSTANCES
    finalWorld = world * finalWorld;
#endif
#endif

    vec3 root = (finalWorld * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 baseWorld = (finalWorld * vec4(position, 1.0)).xyz;
    vec3 world = bendVegetation(baseWorld, root);
    vec4 clip = viewProjection * vec4(world, 1.0);
    vWorld = world;
    vShorelineZ = coastShorelineZ(world.x, shorelineZ, coastlineVariation);
    vViewZ = clip.w;
    vMask = 0.0;
    float focusDistance = distance(world.xz, vegetationFocus);
    vEdgeFade = 1.0 - smoothstep(vegetationRadius * 0.78, vegetationRadius, focusDistance);
    gl_Position = clip;
}
