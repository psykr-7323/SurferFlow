#version 300 es
precision highp float;
precision highp int;
#include<surferFlowSelection>

in vec3 position;
uniform mat4 viewProjection;
uniform vec3 cameraPosition;
uniform float skyScale;
out vec3 vDir;
// Skybox. Drawn as a unit cube pinned to the camera, depth-clamped to the far
// plane so it fills exactly whatever the terrain does not.


void main() {
    vec3 world = position * skyScale + cameraPosition;
    vDir = position;

    vec4 clip = viewProjection * vec4(world, 1.0);
    // Force to the far plane (reversed-Z would flip this; Babylon is not).
    clip.z = clip.w * 0.999999;
    gl_Position = clip;
}
