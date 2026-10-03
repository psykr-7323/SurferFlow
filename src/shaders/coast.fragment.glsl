#version 300 es
precision highp float;
precision highp int;
layout(location = 0) out vec4 fragColor;
#include<surferFlowSelection>

in vec3 vWorld;
in float vViewDist;
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
uniform float sandDetailStrength;
uniform float wetSandWidth;
uniform float shorelineZ;
uniform float coastlineVariation;
uniform float oceanTime;
uniform float shoreFoamStrength;
uniform float fogDensity;
uniform float fogHeightFalloff;
uniform float fogStart;
uniform float aerialStrength;
uniform sampler2D skyLUT;
uniform sampler2D cascade0;
uniform sampler2D cascade1;
uniform sampler2D cascade2;
// First coastal material pass: dry dune sand blends into a darker, damp strip
// at the waterline. Geometry and shading remain camera-independent so the
// existing clipmap can follow the player along the coast.

#include<surferFlowNoise>
#include<surferFlowShading>
#include<surferFlowShadowLookup>
#include<surferFlowAtmosphere>
#include<coastProfile>


// Fade procedural detail as its world-space footprint approaches a pixel. The
// same material can then cover both the close beach and the far clipmap without
// turning the latter into shimmering speckle.
float filteredNoise(vec2 p, float frequency, float footprint) {
    float detailFade = 1.0 - smoothstep(0.30, 1.15, footprint * frequency);
    return noise2(p * frequency) * detailFade;
}


void main() {
    vec3 world = vWorld;
    // This clipmap supplies the land side; the ocean renderer owns z >= 0.
    float shoreline = coastShorelineZ(world.x, shorelineZ, coastlineVariation);
    if(world.z >= shoreline) { discard; }
    // Measure sand detail from the same varying coastline used for clipping.
    // This makes the small ridges follow coves instead of cutting across them.
    float shoreDistance = max(shoreline - world.z, 0.0);
    vec3 V = normalize(cameraPos - world);

    // Use the interpolated heightfield's screen derivatives for the shoreline
    // normal. Face-forward keeps the normal oriented up at every camera angle.
    vec3 dx = dFdx(world);
    vec3 dy = dFdy(world);
    vec3 N = normalize(cross(dy, dx));
    if(dot(N, vec3(0.0, 1.0, 0.0)) < 0.0) { N = -N; }

    // Keep all grains anchored to world coordinates. Derivatives filter their
    // contrast at a distance instead of letting high-frequency sand shimmer.
    float pixelFootprint = max(length(dFdx(world.xz)), length(dFdy(world.xz)));
    float detailStrength = clamp(sandDetailStrength, 0.0, 2.0);
    float broadTone = filteredNoise(world.xz, 0.18, pixelFootprint) * detailStrength;
    vec3 grainField = noised(world.xz * 3.8);
    float grainFade = 1.0 - smoothstep(0.30, 1.15, pixelFootprint * 3.8);
    float grain = grainField.x * grainFade * detailStrength;
    float fleck = filteredNoise(world.xz, 15.0, pixelFootprint) * detailStrength;

    // Wind ripples follow the local shoreline distance. Two gentle, unequal
    // bends and a weak overtone give them natural variation without adding a
    // new noise lookup. The footprint fade suppresses subpixel ridges in the
    // far clipmap rings.
    float shorelineSlope = coastShorelineSlope(world.x, coastlineVariation);
    float rippleWarp = world.x * 0.17 + shoreDistance * 0.045;
    vec2 rippleWarpGradient = vec2(0.17 + shorelineSlope * 0.045, -0.045);
    float alongshoreRippleWarp = world.x * 0.063 + world.z * 0.021;
    float rippleWarpCos = cos(rippleWarp);
    float alongshoreRippleCos = cos(alongshoreRippleWarp);
    float rippleBend = sin(rippleWarp) * 1.15
        + sin(alongshoreRippleWarp) * 0.72;
    float ripplePhase = shoreDistance * 5.6 + rippleBend;
    float rippleFade = (1.0 - smoothstep(0.32, 1.10, pixelFootprint * 5.6))
        * detailStrength;
    vec2 ripplePhaseGradient = vec2(shorelineSlope * 5.6
            + 1.15 * rippleWarpCos * rippleWarpGradient.x
            + 0.72 * alongshoreRippleCos * 0.063, -5.6
            + 1.15 * rippleWarpCos * rippleWarpGradient.y
            + 0.72 * alongshoreRippleCos * 0.021);
    float rippleOvertonePhase = ripplePhase * 2.07 + rippleWarp * 0.33;
    float rippleShape = sin(ripplePhase) + 0.24 * sin(rippleOvertonePhase);
    float ripple = rippleShape * rippleFade;
    vec2 rippleShapeGradient = cos(ripplePhase) * ripplePhaseGradient
        + 0.24 * cos(rippleOvertonePhase)
            * (ripplePhaseGradient * 2.07 + rippleWarpGradient * 0.33);

    vec3 drySand = vec3(0.57, 0.405, 0.225)
        * (1.0 + broadTone * 0.14 + grain * 0.065 + fleck * 0.024);
    vec3 dampSand = vec3(0.405, 0.300, 0.175)
        * (1.0 + broadTone * 0.10 + grain * 0.045 + fleck * 0.016);
    vec3 saturatedSand = vec3(0.255, 0.205, 0.135)
        * (1.0 + broadTone * 0.07 + grain * 0.025);

    // Break the damp margin into natural coves and tongues while keeping it
    // anchored to the shared alongshore shoreline profile.
    float marginNoise = noise2(vec2(world.x * 0.035, 13.7)) * 1.15
        + noise2(vec2(world.x * 0.105, 47.2)) * 0.26;
    float dampMargin = max(wetSandWidth, 0.5) + marginNoise;
    float dampness = 1.0 - smoothstep(0.45, dampMargin, shoreDistance);
    float saturated = 1.0 - smoothstep(0.08, 1.35, shoreDistance);
    vec3 albedo = mix(drySand, dampSand, dampness * 0.90);
    albedo = mix(albedo, saturatedSand, saturated * 0.82);
    // Backdunes carry green groundcover in the same broad patches as the plants.
    float grove = 0.50 + 0.26 * sin(world.x * 0.037 + sin(world.z * 0.026))
        + 0.24 * sin(world.z * 0.049 - world.x * 0.018);
    float inland = smoothstep(30.0, 64.0, shoreDistance);
    float cover = inland * smoothstep(0.24, 0.80, grove) * 0.85;
    vec3 grassSoil = mix(vec3(0.19, 0.23, 0.065), vec3(0.23, 0.31, 0.085), grove)
        * (1.0 + grain * 0.06 + broadTone * 0.10);
    albedo = mix(albedo, grassSoil, cover);

    float rippleContrast = mix(0.022, 0.010, dampness) * (1.0 - saturated * 0.72);
    albedo *= 1.0 + ripple * rippleContrast;

    // A restrained grain normal and separate dry, damp, and water-saturated
    // roughness keep the shoreline readable in both direct light and reflection.
    vec2 grainSlope = grainField.yz * (3.8 * grainFade * 0.012 * detailStrength);
    vec2 rippleSlope = rippleShapeGradient
        * (rippleFade * rippleContrast * 0.62);
    N = normalize(N + vec3(-grainSlope.x - rippleSlope.x, 0.0, -grainSlope.y - rippleSlope.y));
    float dryRoughness = clamp(0.80 - broadTone * 0.035 - grain * 0.018, 0.74, 0.86);
    float roughness = mix(mix(dryRoughness, 0.55, dampness), 0.34, saturated);
    vec3 f0 = vec3(0.025);

    float noiseRot = grain * 6.28318530718;
    float shadow = sunShadow(world, N, vViewDist, noiseRot);
    float NdotL = max(dot(N, sunDir), 0.0);
    float NdotV = max(dot(N, V), 1e-4);
    vec3 diffuse = albedo * sunRadiance * (NdotL / 3.14159265359) * shadow;

    vec3 color = diffuse + albedo * shIrradiance(N, shR)
        * (ambientIntensity / 3.14159265359);

    // Damp sand carries a broad sky reflection; saturated sand is smoother but
    // remains rougher than the ocean so the boundary stays visually distinct.
    vec3 R = reflect(-V, N);
    vec3 skyRefl = textureLod(skyLUT, dirToLatLong(R), sqrt(roughness) * 6.0).rgb;
    vec3 F = fresnelSchlickRough(NdotV, f0, roughness);
    color += skyRefl * F * mix(0.14, 0.48, max(dampness, saturated));

    // Thin swash reaches onto the wet sand. The sea and sand use one front,
    // preventing a gap or a foam stripe detached from the beach.
    float swash = coastSwashFoam(world.xz, -shoreDistance, oceanTime, pixelFootprint)
        * shoreFoamStrength;
    vec3 foamLight = vec3(0.90, 0.96, 1.0) * (
        sunRadiance * max(0.0, sunDir.y) / 3.14159265359
        + shIrradiance(vec3(0.0, 1.0, 0.0), shR)
            * ambientIntensity / 3.14159265359
    );
    color = mix(color, foamLight, clamp(swash, 0.0, 0.92));

    color = applyAerial(color, cameraPos, world, -V, sunDir, skyLUT, sunRadiance, fogDensity, fogHeightFalloff, fogStart, aerialStrength);

    fragColor = vec4(color, 1.0);
}
