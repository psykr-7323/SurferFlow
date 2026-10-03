#version 300 es
precision highp float;
precision highp int;
layout(location = 0) out vec4 fragColor;
#include<surferFlowSelection>

in vec3 vWorld;
in vec3 vNormal;
in vec4 vColor;
in float vViewDist;
in float vEdgeFade;
in float vShorelineZ;
uniform vec3 cameraPos;
uniform vec3 sunDir;
uniform vec3 sunRadiance;
uniform vec4 shR[9];
uniform mat4 cascadeMatrices[3];
uniform vec4 cascadeSplits;
uniform vec4 cascadeParams[3];
uniform float shadowTexel;
uniform float shadowSoftness;
uniform float shadowBias;
uniform float ambientIntensity;
uniform float fogDensity;
uniform float fogHeightFalloff;
uniform float fogStart;
uniform float aerialStrength;
uniform sampler2D skyLUT;
uniform sampler2D cascade0;
uniform sampler2D cascade1;
uniform sampler2D cascade2;
#include<surferFlowNoise>
#include<surferFlowShading>
#include<surferFlowShadowLookup>
#include<surferFlowAtmosphere>


void main() {
    vec3 world = vWorld;
    if(world.z >= vShorelineZ - 5.0) { discard; }

    vec3 V = normalize(cameraPos - world);
    vec3 N = normalize(vNormal);
    if(dot(N, V) < 0.0) { N = -N; }
    vec3 geoN = N;
    vec3 L = sunDir;
    vec3 albedo = vColor.rgb;
    float noiseRot = fract(dot(world.xz, vec2(0.017, 0.031))) * 6.28318530718;
    float shadow = sunShadow(world, geoN, vViewDist, noiseRot);
    float NdotL = max(dot(N, L), 0.0);
    vec3 diffuse = albedo * sunRadiance * (NdotL / 3.14159265359) * shadow;
    vec3 color = diffuse + albedo * shIrradiance(N, shR)
        * (ambientIntensity / 3.14159265359);

    // A restrained leaf transmission term keeps back-lit grass readable while
    // sharing the same atmospheric and solar energy scale as the coast.
    color += surferFlowSubsurface(N, L, V, sunRadiance, 0.22, 0.18, 0.7)
        * albedo * shadow;

    vec3 aerial = applyAerial(color, cameraPos, world, -V, sunDir, skyLUT, sunRadiance, fogDensity, fogHeightFalloff, fogStart, aerialStrength);
    vec3 horizon = textureLod(skyLUT, dirToLatLong(-V), 0.0).rgb;
    fragColor = vec4(mix(horizon, aerial, vEdgeFade), 1.0);
}
