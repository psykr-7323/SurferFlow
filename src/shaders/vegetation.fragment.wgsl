#include<rideNoise>
#include<rideShading>
#include<rideShadowLookup>
#include<rideAtmosphere>

varying vWorld: vec3f;
varying vNormal: vec3f;
varying vColor: vec4f;
varying vViewDist: f32;
varying vEdgeFade: f32;
varying vShorelineZ: f32;

uniform cameraPos: vec3f;
uniform sunDir: vec3f;
uniform sunRadiance: vec3f;
uniform shR: array<vec4f, 9>;
uniform cascadeMatrices: array<mat4x4f, 3>;
uniform cascadeSplits: vec4f;
uniform cascadeParams: array<vec4f, 3>;
uniform shadowTexel: f32;
uniform shadowSoftness: f32;
uniform shadowBias: f32;
uniform ambientIntensity: f32;
uniform fogDensity: f32;
uniform fogHeightFalloff: f32;
uniform fogStart: f32;
uniform aerialStrength: f32;

var skyLUT: texture_2d<f32>;
var skyLUTSampler: sampler;
var cascade0: texture_2d<f32>;
var cascade0Sampler: sampler;
var cascade1: texture_2d<f32>;
var cascade1Sampler: sampler;
var cascade2: texture_2d<f32>;
var cascade2Sampler: sampler;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let world = input.vWorld;
    if (world.z >= input.vShorelineZ - 5.0) { discard; }

    let V = normalize(uniforms.cameraPos - world);
    var N = normalize(input.vNormal);
    if (dot(N, V) < 0.0) { N = -N; }
    let geoN = N;
    let L = uniforms.sunDir;
    let albedo = input.vColor.rgb;
    let noiseRot = fract(dot(world.xz, vec2f(0.017, 0.031))) * 6.28318530718;
    let shadow = sunShadow(world, geoN, input.vViewDist, noiseRot);
    let NdotL = max(dot(N, L), 0.0);
    let diffuse = albedo * uniforms.sunRadiance * (NdotL / 3.14159265359) * shadow;
    var color = diffuse + albedo * shIrradiance(N, uniforms.shR)
        * (uniforms.ambientIntensity / 3.14159265359);

    // A restrained leaf transmission term keeps back-lit grass readable while
    // sharing the same atmospheric and solar energy scale as the coast.
    color += rideSubsurface(N, L, V, uniforms.sunRadiance, 0.22, 0.18, 0.7)
        * albedo * shadow;

    let aerial = applyAerial(
        color, uniforms.cameraPos, world, -V, uniforms.sunDir,
        skyLUT, skyLUTSampler, uniforms.sunRadiance,
        uniforms.fogDensity, uniforms.fogHeightFalloff,
        uniforms.fogStart, uniforms.aerialStrength
    );
    let horizon = textureSampleLevel(skyLUT, skyLUTSampler, dirToLatLong(-V), 0.0).rgb;
    fragmentOutputs.color = vec4f(mix(horizon, aerial, input.vEdgeFade), 1.0);
}
