// -----------------------------------------------------------------------------
// Coastal spray and droplets.
//
// The pooled billboards now read as translucent water droplets and fine mist.
// Soft particles stay hazy; hard particles get a tighter highlight and firmer
// silhouette. They retain the same pool state, shadowing, and spell-light path.
//
// The billboard is shaded as a sphere so its water tint and specular highlight
// follow a rounded droplet instead of reading as a flat disc.
// -----------------------------------------------------------------------------

#include<rideNoise>
#include<rideShading>
#include<rideSpellLights>
#include<rideAtmosphere>

varying vWorld: vec3f;
varying vCorner: vec2f;
varying vState: vec4f;
varying vViewDist: f32;

var skyLUT: texture_2d<f32>;
var skyLUTSampler: sampler;
var cascade0: texture_2d<f32>;
var cascade0Sampler: sampler;
var cascade1: texture_2d<f32>;
var cascade1Sampler: sampler;
var cascade2: texture_2d<f32>;
var cascade2Sampler: sampler;

uniform cameraPos: vec3f;
uniform camRight: vec3f;
uniform camUp: vec3f;
uniform sunDir: vec3f;
uniform sunRadiance: vec3f;
uniform shR: array<vec4f, 9>;

uniform cascadeMatrices: array<mat4x4f, 3>;
uniform cascadeSplits: vec4f;
uniform cascadeParams: array<vec4f, 3>;
uniform shadowTexel: f32;
uniform shadowSoftness: f32;
uniform shadowBias: f32;

uniform fogDensity: f32;
uniform fogHeightFalloff: f32;
uniform fogStart: f32;
uniform aerialStrength: f32;
uniform ambientIntensity: f32;

uniform spellLightPos: array<vec4f, 4>;
uniform spellLightCol: array<vec4f, 4>;
uniform spellLightCount: f32;

#include<rideShadowLookup>

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let r2 = dot(input.vCorner, input.vCorner);
    if (r2 > 1.0) { discard; }

    let state = input.vState;
    let kind = state.z;

    // Break the disc's edge. A perfectly circular puff is the tell that gives
    // billboards away; a hashed radial wobble costs one noise fetch.
    let ang = atan2(input.vCorner.y, input.vCorner.x);
    let wob = 1.0 + 0.34 * noise2(vec2f(cos(ang), sin(ang)) * 2.4 + state.y * 37.0);
    let r = sqrt(r2) / wob;
    if (r > 1.0) { discard; }

    // Soft-edged for fine mist, harder for a water droplet.
    let edge = mix(
        pow(clamp(1.0 - r * r, 0.0, 1.0), 1.6),
        smoothstep(1.0, 0.65, r),
        kind
    );
    // Keep individual particles translucent; overlapping drops build the spray.
    let alpha = state.w * edge * mix(0.18, 0.34, kind);
    if (alpha < 0.004) { discard; }

    // Spherical normal from the billboard's own coordinates.
    let world = input.vWorld;
    let V = normalize(uniforms.cameraPos - world);
    let L = uniforms.sunDir;
    let nz = sqrt(max(0.0, 1.0 - r2));
    let N = normalize(
        uniforms.camRight * input.vCorner.x + uniforms.camUp * input.vCorner.y + V * nz
    );

    let noiseRot = ign(input.position.xy) * 6.28318530718;
    let shadow = sunShadow(world, N, input.vViewDist, noiseRot);

    let sun = uniforms.sunRadiance;
    const INV_PI: f32 = 0.31830988618;

    // Cool water tint, diffuse reflection, and a narrow sun glint. Hard droplets
    // have the sharper highlight; the finer mist stays mostly diffuse.
    let albedo = vec3f(0.28, 0.66, 0.82);
    let diff = wrapDiffuse(dot(N, L), 0.25);
    var color = albedo * INV_PI * sun * diff * shadow * 0.30;

    let H = normalize(V + L);
    let specPower = mix(24.0, 72.0, kind);
    let specStrength = mix(0.08, 0.42, kind);
    let specular = pow(max(dot(N, H), 0.0), specPower) * specStrength * shadow;
    color += sun * specular;

    // Fresnel rim gives each rounded particle a faint wet edge without making
    // the whole billboard opaque.
    let fresnel = pow(1.0 - max(dot(N, V), 0.0), 5.0);
    color += vec3f(0.06, 0.28, 0.40) * fresnel * 0.25;
    color += albedo * INV_PI * shIrradiance(N, uniforms.shR) * uniforms.ambientIntensity * 0.25;

    // Preserve spell lighting for droplets passing through spell effects.
    if (uniforms.spellLightCount > 0.5) {
        color += spellLightingParticle(
            world, N, albedo,
            uniforms.spellLightPos, uniforms.spellLightCol, uniforms.spellLightCount
        );
    }

    color = applyAerial(
        color, uniforms.cameraPos, world, -V, L,
        skyLUT, skyLUTSampler, sun,
        uniforms.fogDensity, uniforms.fogHeightFalloff, uniforms.fogStart,
        uniforms.aerialStrength
    );

    fragmentOutputs.color = vec4f(color, alpha);
}
