#version 300 es
precision highp float;
precision highp int;
layout(location = 0) out vec4 fragColor;
#include<surferFlowSelection>

in vec3 vWorld;
uniform float shorelineZ;
uniform float coastlineVariation;
// Writes NDC depth into the cascade atlas as R32F.
//
// Stored as a plain colour rather than sampled from a depth texture so PCSS can
// do its blocker search with ordinary filtered fetches — a comparison sampler
// would only ever hand back a pre-thresholded result, which is the one thing the
// blocker search cannot use.

#include<coastProfile>

#ifdef SURFERFLOW_CASCADE


#endif


void main() {
#ifdef SURFERFLOW_CASCADE
    float shoreline = coastShorelineZ(vWorld.x, shorelineZ, coastlineVariation);
    if(vWorld.z >= shoreline) { discard; }
#endif
    fragColor = vec4(gl_FragCoord.z, 0.0, 0.0, 1.0);
}
