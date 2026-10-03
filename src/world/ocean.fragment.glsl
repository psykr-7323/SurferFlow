#version 300 es
precision highp float;
precision highp int;
layout(location = 0) out vec4 fragColor;
#include<surferFlowSelection>

in vec3 vWorld;
in vec3 vNormal;
in float vViewDist;
in float vSpacing;
uniform sampler2D skyLUT;
uniform vec3 cameraPos;
uniform float oceanTime;
uniform float shorelineZ;
uniform float coastlineVariation;
uniform float waterLevel;
uniform float oceanColorSpan;
uniform float shoreFoamStrength;
uniform vec2 wakePosition;
uniform vec2 wakeForward;
uniform float wakeActivity;
uniform float wakeSpeed;
uniform vec3 sunDir;
uniform vec3 sunRadiance;
uniform float waveHeightScale;
uniform float waveSpeedScale;
#include<coastProfile>
#include<surferFlowNoise>

// Opaque coastal ocean shading with depth color, wave crest foam, and a broken
// moving run-up band at the world-space shoreline.


vec2 dirToLatLong(vec3 d) {
    float u = atan(d.x, d.z) / (2.0 * PI) + 0.5;
    float v = acos(clamp(d.y, -1.0, 1.0)) / PI;
    return vec2(u, v);
}


void main() {
    // The sea occupies the +Z side of the fixed coastline. Discarding in the
    // fragment stage keeps the edge at the exact world-space shoreline even
    // when the camera-following grid shifts.
    float shoreline = coastShorelineZ(vWorld.x, shorelineZ, coastlineVariation);
    if(vWorld.z < shoreline) { discard; }

    vec3 world = vWorld;
    vec3 V = normalize(cameraPos - world);
    vec3 N = normalize(vNormal);
    vec3 waveNormal = N;

    // Pixel-scale, directional ripples keep the distant, coarsened clipmap from
    // reading as a perfectly smooth plate. Derivatives and clipmap spacing both
    // fade detail before it aliases in the far rings.
    vec2 p = world.xz;
    float t = oceanTime * waveSpeedScale;
    float waveHeight = world.y - waterLevel;
    // Two broad, crossing swells bend the fine reflections independently.
    // They affect shading only; the rendered surface remains the same field
    // used by the CPU sampler, so geometry and shoreline stay in agreement.
    float swellPhase0 = dot(p, vec2(0.072, -0.041)) - t * 0.12;
    float swellPhase1 = dot(p, vec2(-0.034, 0.086)) + t * 0.095;
    float swell0 = sin(swellPhase0);
    float swell1 = sin(swellPhase1 + swell0 * 0.48);
    float warp0 = 1.18 * swell0 + 0.43 * swell1 + waveHeight * 0.72;
    float warp1 = -0.52 * swell0 + 0.88 * swell1 + waveHeight * 0.46;
    float r0 = dot(p, vec2(0.74, 1.0)) * 1.65 - t * 2.8 + warp0;
    float r1 = dot(p, vec2(-1.0, 0.48)) * 2.35 + t * 3.6 + warp1;
    float pixelFootprint = max(length(dFdx(p)), length(dFdy(p)));
    float detailFade = (1.0 - smoothstep(2.0, 8.0, vSpacing))
        * (1.0 - smoothstep(0.28, 1.1, pixelFootprint * 2.35));
    // Slowly varied amplitudes keep the reflected facets from repeating as a
    // uniform crosshatch. Clipmap and pixel-footprint filtering still remove
    // these details before the outer rings become unstable.
    float facet0 = 0.82 + 0.18 * sin(dot(p, vec2(0.031, 0.052)) - t * 0.16);
    float facet1 = 0.78 + 0.22 * sin(dot(p, vec2(-0.046, 0.027)) + t * 0.13);
    vec2 detail = vec2(cos(r0) * 0.025 * facet0 + cos(r1) * 0.014 * facet1, cos(r0) * 0.034 * facet0 - cos(r1) * 0.019 * facet1)
        * detailFade;
    N = normalize(N + vec3(detail.x, 0.0, detail.y));

    float NdotV = clamp(dot(N, V), 0.02, 1.0);
    float shoreDistance = max(world.z - shoreline, 0.0);
    float depthBlend = smoothstep(0.0, max(oceanColorSpan, 1.0), shoreDistance);
    vec3 shallow = vec3(0.025, 0.37, 0.32);
    vec3 deep = vec3(0.007, 0.075, 0.18);
    vec3 color = mix(shallow, deep, depthBlend);

    // Nearshore suspended-sand scattering shifts the shallow water toward a
    // muted green teal. The broad wave height also adds restrained light/shade
    // variation, tied to the actual displaced surface rather than a screen effect.
    float nearshoreScatter = 1.0 - smoothstep(2.0, 58.0, shoreDistance);
    color = mix(color, vec3(0.065, 0.40, 0.30), nearshoreScatter * 0.24);
    color *= 1.0 + clamp(waveHeight * 0.045, -0.055, 0.055);

    // The analytic sky LUT provides environment reflections without an extra
    // scene-color copy or another render pass.
    vec3 reflected = reflect(-V, N);
    vec3 sky = textureLod(skyLUT, dirToLatLong(reflected), 0.5).rgb;
    float fresnel = 0.02 + 0.96 * pow(1.0 - NdotV, 5.0);
    vec3 skyFill = textureLod(skyLUT, vec2(0.5, 0.08), 2.0).rgb;
    vec3 waterLight = sunRadiance * max(0.0, sunDir.y) * 0.20
        + skyFill * 0.30;
    color *= waterLight;
    color = mix(color, sky, fresnel * 0.96);

    vec3 L = normalize(sunDir);
    vec3 H = normalize(V + L);
    float specAngle = max(dot(N, H), 0.0);
    float broadGlint = pow(specAngle, 36.0) * 0.045;
    float tightGlint = pow(specAngle, 176.0) * 0.24;
    color += sunRadiance * (broadGlint + tightGlint);

    // Broken foam on incoming shallow-water waves.
    float breakup = clamp(0.63
        + 0.20 * sin(world.x * 1.45 + world.z * 2.1 - t * 2.2
            + waveHeight * 2.8 + waveNormal.x * 3.0)
        + 0.17 * sin(world.x * 0.64 - world.z * 3.7 + t * 3.1
            + waveHeight * 4.1 + waveNormal.z * 2.2), 0.0, 1.0);

    // The vertex stage already exports displaced height and its matching
    // normal. Use both to break foam along raised, steeper wave crests instead
    // of drawing only a shoreline-parallel stripe.
    float crestHeight = smoothstep(0.34, 0.78, waveHeight / max(0.05, waveHeightScale))
        * smoothstep(0.0, 0.15, waveHeightScale);
    float crestSlope = smoothstep(0.025, 0.16, length(waveNormal.xz));
    float crestMask = crestHeight * mix(0.34, 1.0, crestSlope);
    float crestBreakup = clamp(0.68
        + 0.18 * sin(world.x * 0.39 + world.z * 0.25 - t * 1.1
            + waveHeight * 2.0 + waveNormal.x * 2.4)
        + 0.14 * sin(world.x * 0.91 - world.z * 0.53 + t * 1.8
            + waveHeight * 3.2 + waveNormal.z * 1.8), 0.0, 1.0);
    float shoreSwash = coastSwashFoam(p, shoreDistance, t, pixelFootprint);
    float breakingPhase = shoreDistance * 0.28 + t * 0.88 + world.x * 0.034;
    float breaker = pow(max(0.0, sin(breakingPhase)), 12.0)
        * smoothstep(2.0, 5.0, shoreDistance)
        * (1.0 - smoothstep(14.0, 28.0, shoreDistance));
    float cells = noise2(p * 2.6 + vec2(t * 0.18, -t * 0.31));
    float foam = clamp(max(max(shoreSwash, breaker * breakup), crestMask * crestBreakup)
            * shoreFoamStrength * (0.82 + cells * 0.28), 0.0, 1.0);
    vec3 foamColor = vec3(0.90, 0.96, 1.0) * (
        sunRadiance * max(0.0, sunDir.y) / PI + skyFill * 0.70
    );
    color = mix(color, foamColor, foam * 0.92);

    // A transient V-shaped foam trail follows the surfer. It is evaluated as
    // part of the water material, so there is no per-frame wake mesh upload.
    vec2 forward = normalize(wakeForward);
    vec2 right = vec2(forward.y, -forward.x);
    vec2 rel = world.xz - wakePosition;
    float along = dot(rel, forward);
    float behind = -along;
    float lateral = abs(dot(rel, right));
    float spread = 0.18 + behind * mix(0.075, 0.12, clamp(wakeSpeed / 19.5, 0.0, 1.0));
    float waveEdge = spread + 0.075 * sin(behind * 0.82 - t * 2.2 + world.x * 0.07);
    float edgeWidth = 0.15 + behind * 0.018;
    float edgeDistance = abs(lateral - waveEdge);
    float wakeLine = 1.0 - smoothstep(edgeWidth, edgeWidth + 0.46, edgeDistance);
    float wakeTail = smoothstep(0.25, 1.1, behind) * (1.0 - smoothstep(11.0, 19.0, behind));
    float wakeBreakup = clamp(0.58
        + 0.22 * sin(world.x * 2.1 + world.z * 1.3 - t * 5.2)
        + 0.20 * sin(world.x * 4.4 - world.z * 2.7 + t * 3.7), 0.0, 1.0);
    float wakeFoam = clamp(wakeLine * wakeTail * wakeBreakup * wakeActivity
            * shoreFoamStrength, 0.0, 1.0);
    color = mix(color, foamColor, wakeFoam * 0.82);

    // The camera far plane is 4.2 km, so blend the water into the sky before it
    // reaches that clipping distance. The outer clipmap edge sits just beyond
    // the default far plane and follows the player without geometry uploads.
    vec3 ray = normalize(world - cameraPos);
    vec3 horizonDir = normalize(vec3(ray.x, max(ray.y, 0.025), ray.z));
    vec3 horizonSky = textureLod(skyLUT, dirToLatLong(horizonDir), 0.0).rgb;
    float farFade = smoothstep(3200.0, 4100.0, vViewDist);
    color = mix(color, horizonSky, farFade);

    fragColor = vec4(color, 1.0);
}
