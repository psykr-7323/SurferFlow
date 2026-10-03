// First coastal material pass: dry dune sand blends into a darker, damp strip
// at the waterline. Geometry and shading remain camera-independent so the
// existing clipmap can follow the player along the coast.

#include<rideNoise>
#include<rideShading>
#include<rideShadowLookup>
#include<rideAtmosphere>
#include<coastProfile>

varying vWorld: vec3f;
varying vViewDist: f32;

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
uniform sandDetailStrength: f32;
uniform wetSandWidth: f32;
uniform shorelineZ: f32;
uniform coastlineVariation: f32;
uniform oceanTime: f32;
uniform shoreFoamStrength: f32;
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

// Fade procedural detail as its world-space footprint approaches a pixel. The
// same material can then cover both the close beach and the far clipmap without
// turning the latter into shimmering speckle.
fn filteredNoise(p: vec2f, frequency: f32, footprint: f32) -> f32 {
    let detailFade = 1.0 - smoothstep(0.30, 1.15, footprint * frequency);
    return noise2(p * frequency) * detailFade;
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let world = input.vWorld;
    // This clipmap supplies the land side; the ocean renderer owns z >= 0.
    let shoreline = coastShorelineZ(
        world.x, uniforms.shorelineZ, uniforms.coastlineVariation
    );
    if (world.z >= shoreline) { discard; }
    // Measure sand detail from the same varying coastline used for clipping.
    // This makes the small ridges follow coves instead of cutting across them.
    let shoreDistance = max(shoreline - world.z, 0.0);
    let V = normalize(uniforms.cameraPos - world);

    // Use the interpolated heightfield's screen derivatives for the shoreline
    // normal. Face-forward keeps the normal oriented up at every camera angle.
    let dx = dpdx(world);
    let dy = dpdy(world);
    var N = normalize(cross(dy, dx));
    if (dot(N, vec3f(0.0, 1.0, 0.0)) < 0.0) { N = -N; }

    // Keep all grains anchored to world coordinates. Derivatives filter their
    // contrast at a distance instead of letting high-frequency sand shimmer.
    let pixelFootprint = max(length(dpdx(world.xz)), length(dpdy(world.xz)));
    let detailStrength = clamp(uniforms.sandDetailStrength, 0.0, 2.0);
    let broadTone = filteredNoise(world.xz, 0.18, pixelFootprint) * detailStrength;
    let grainField = noised(world.xz * 3.8);
    let grainFade = 1.0 - smoothstep(0.30, 1.15, pixelFootprint * 3.8);
    let grain = grainField.x * grainFade * detailStrength;
    let fleck = filteredNoise(world.xz, 15.0, pixelFootprint) * detailStrength;

    // Wind ripples follow the local shoreline distance. Two gentle, unequal
    // bends and a weak overtone give them natural variation without adding a
    // new noise lookup. The footprint fade suppresses subpixel ridges in the
    // far clipmap rings.
    let shorelineSlope = coastShorelineSlope(
        world.x, uniforms.coastlineVariation
    );
    let rippleWarp = world.x * 0.17 + shoreDistance * 0.045;
    let rippleWarpGradient = vec2f(
        0.17 + shorelineSlope * 0.045,
        -0.045
    );
    let alongshoreRippleWarp = world.x * 0.063 + world.z * 0.021;
    let rippleWarpCos = cos(rippleWarp);
    let alongshoreRippleCos = cos(alongshoreRippleWarp);
    let rippleBend = sin(rippleWarp) * 1.15
        + sin(alongshoreRippleWarp) * 0.72;
    let ripplePhase = shoreDistance * 5.6 + rippleBend;
    let rippleFade = (1.0 - smoothstep(0.32, 1.10, pixelFootprint * 5.6))
        * detailStrength;
    let ripplePhaseGradient = vec2f(
        shorelineSlope * 5.6
            + 1.15 * rippleWarpCos * rippleWarpGradient.x
            + 0.72 * alongshoreRippleCos * 0.063,
        -5.6
            + 1.15 * rippleWarpCos * rippleWarpGradient.y
            + 0.72 * alongshoreRippleCos * 0.021
    );
    let rippleOvertonePhase = ripplePhase * 2.07 + rippleWarp * 0.33;
    let rippleShape = sin(ripplePhase) + 0.24 * sin(rippleOvertonePhase);
    let ripple = rippleShape * rippleFade;
    let rippleShapeGradient = cos(ripplePhase) * ripplePhaseGradient
        + 0.24 * cos(rippleOvertonePhase)
            * (ripplePhaseGradient * 2.07 + rippleWarpGradient * 0.33);

    let drySand = vec3f(0.57, 0.405, 0.225)
        * (1.0 + broadTone * 0.14 + grain * 0.065 + fleck * 0.024);
    let dampSand = vec3f(0.405, 0.300, 0.175)
        * (1.0 + broadTone * 0.10 + grain * 0.045 + fleck * 0.016);
    let saturatedSand = vec3f(0.255, 0.205, 0.135)
        * (1.0 + broadTone * 0.07 + grain * 0.025);

    // Break the damp margin into natural coves and tongues while keeping it
    // anchored to the shared alongshore shoreline profile.
    let marginNoise = noise2(vec2f(world.x * 0.035, 13.7)) * 1.15
        + noise2(vec2f(world.x * 0.105, 47.2)) * 0.26;
    let dampMargin = max(uniforms.wetSandWidth, 0.5) + marginNoise;
    let dampness = 1.0 - smoothstep(0.45, dampMargin, shoreDistance);
    let saturated = 1.0 - smoothstep(0.08, 1.35, shoreDistance);
    var albedo = mix(drySand, dampSand, dampness * 0.90);
    albedo = mix(albedo, saturatedSand, saturated * 0.82);
    let rippleContrast = mix(0.022, 0.010, dampness) * (1.0 - saturated * 0.72);
    albedo *= 1.0 + ripple * rippleContrast;

    // A restrained grain normal and separate dry, damp, and water-saturated
    // roughness keep the shoreline readable in both direct light and reflection.
    let grainSlope = grainField.yz * (3.8 * grainFade * 0.012 * detailStrength);
    let rippleSlope = rippleShapeGradient
        * (rippleFade * rippleContrast * 0.62);
    N = normalize(N + vec3f(
        -grainSlope.x - rippleSlope.x,
        0.0,
        -grainSlope.y - rippleSlope.y
    ));
    let dryRoughness = clamp(0.80 - broadTone * 0.035 - grain * 0.018, 0.74, 0.86);
    let roughness = mix(mix(dryRoughness, 0.55, dampness), 0.34, saturated);
    let f0 = vec3f(0.025);

    let noiseRot = grain * 6.28318530718;
    let shadow = sunShadow(world, N, input.vViewDist, noiseRot);
    let NdotL = max(dot(N, uniforms.sunDir), 0.0);
    let NdotV = max(dot(N, V), 1e-4);
    let diffuse = albedo * uniforms.sunRadiance * (NdotL / 3.14159265359) * shadow;

    var color = diffuse + albedo * shIrradiance(N, uniforms.shR)
        * (uniforms.ambientIntensity / 3.14159265359);

    // Damp sand carries a broad sky reflection; saturated sand is smoother but
    // remains rougher than the ocean so the boundary stays visually distinct.
    let R = reflect(-V, N);
    let skyRefl = textureSampleLevel(skyLUT, skyLUTSampler, dirToLatLong(R), sqrt(roughness) * 6.0).rgb;
    let F = fresnelSchlickRough(NdotV, f0, roughness);
    color += skyRefl * F * mix(0.14, 0.48, max(dampness, saturated));

    // Thin swash reaches onto the wet sand. The sea and sand use one front,
    // preventing a gap or a foam stripe detached from the beach.
    let swash = coastSwashFoam(world.xz, -shoreDistance, uniforms.oceanTime, pixelFootprint)
        * uniforms.shoreFoamStrength;
    let foamLight = vec3f(0.90, 0.96, 1.0) * (
        uniforms.sunRadiance * max(0.0, uniforms.sunDir.y) / 3.14159265359
        + shIrradiance(vec3f(0.0, 1.0, 0.0), uniforms.shR)
            * uniforms.ambientIntensity / 3.14159265359
    );
    color = mix(color, foamLight, clamp(swash, 0.0, 0.92));

    color = applyAerial(
        color, uniforms.cameraPos, world, -V, uniforms.sunDir,
        skyLUT, skyLUTSampler, uniforms.sunRadiance,
        uniforms.fogDensity, uniforms.fogHeightFalloff,
        uniforms.fogStart, uniforms.aerialStrength
    );

    fragmentOutputs.color = vec4f(color, 1.0);
}
