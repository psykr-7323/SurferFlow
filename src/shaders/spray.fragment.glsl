#version 300 es
precision highp float;
precision highp int;
layout(location = 0) out vec4 fragColor;
#include<surferFlowSelection>

in vec3 vWorld;
in vec2 vCorner;
in vec4 vState;
in float vViewDist;
uniform sampler2D skyLUT;
uniform sampler2D cascade0;
uniform sampler2D cascade1;
uniform sampler2D cascade2;
uniform vec3 cameraPos;
uniform vec3 camRight;
uniform vec3 camUp;
uniform vec3 sunDir;
uniform vec3 sunRadiance;
uniform vec4 shR[9];
uniform mat4 cascadeMatrices[3];
uniform vec4 cascadeSplits;
uniform vec4 cascadeParams[3];
uniform float shadowTexel;
uniform float shadowSoftness;
uniform float shadowBias;
uniform float fogDensity;
uniform float fogHeightFalloff;
uniform float fogStart;
uniform float aerialStrength;
uniform float ambientIntensity;
// -----------------------------------------------------------------------------
// Coastal spray and droplets.
//
// The pooled billboards now read as translucent water droplets and fine mist.
// Soft particles stay hazy; hard particles get a tighter highlight and firmer
// silhouette. They retain the same pool state, and shadowing.
//
// The billboard is shaded as a sphere so its water tint and specular highlight
// follow a rounded droplet instead of reading as a flat disc.
// -----------------------------------------------------------------------------

#include<surferFlowNoise>
#include<surferFlowShading>
#include<surferFlowAtmosphere>


#include<surferFlowShadowLookup>


void main() {
    float r2 = dot(vCorner, vCorner);
    if(r2 > 1.0) { discard; }

    vec4 state = vState;
    float kind = state.z;

    // Break the disc's edge. A perfectly circular puff is the tell that gives
    // billboards away; a hashed radial wobble costs one noise fetch.
    float ang = atan(vCorner.y, vCorner.x);
    float wob = 1.0 + 0.34 * noise2(vec2(cos(ang), sin(ang)) * 2.4 + state.y * 37.0);
    float r = sqrt(r2) / wob;
    if(r > 1.0) { discard; }

    // Soft-edged for fine mist, harder for a water droplet.
    float edge = mix(pow(clamp(1.0 - r * r, 0.0, 1.0), 1.6), smoothstep(1.0, 0.65, r), kind);
    // Keep individual particles translucent; overlapping drops build the spray.
    float alpha = state.w * edge * mix(0.18, 0.34, kind);
    if(alpha < 0.004) { discard; }

    // Spherical normal from the billboard's own coordinates.
    vec3 world = vWorld;
    vec3 V = normalize(cameraPos - world);
    vec3 L = sunDir;
    float nz = sqrt(max(0.0, 1.0 - r2));
    vec3 N = normalize(camRight * vCorner.x + camUp * vCorner.y + V * nz);

    float noiseRot = ign(gl_FragCoord.xy) * 6.28318530718;
    float shadow = sunShadow(world, N, vViewDist, noiseRot);

    vec3 sun = sunRadiance;
    const float INV_PI = 0.31830988618;

    // Cool water tint, diffuse reflection, and a narrow sun glint. Hard droplets
    // have the sharper highlight; the finer mist stays mostly diffuse.
    vec3 albedo = vec3(0.28, 0.66, 0.82);
    float diff = wrapDiffuse(dot(N, L), 0.25);
    vec3 color = albedo * INV_PI * sun * diff * shadow * 0.30;

    vec3 H = normalize(V + L);
    float specPower = mix(24.0, 72.0, kind);
    float specStrength = mix(0.08, 0.42, kind);
    float specular = pow(max(dot(N, H), 0.0), specPower) * specStrength * shadow;
    color += sun * specular;

    // Fresnel rim gives each rounded particle a faint wet edge without making
    // the whole billboard opaque.
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 5.0);
    color += vec3(0.06, 0.28, 0.40) * fresnel * 0.25;
    color += albedo * INV_PI * shIrradiance(N, shR) * ambientIntensity * 0.25;


    color = applyAerial(color, cameraPos, world, -V, L, skyLUT, sun, fogDensity, fogHeightFalloff, fogStart, aerialStrength);

    fragColor = vec4(color, alpha);
}
