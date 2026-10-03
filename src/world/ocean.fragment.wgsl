#include<coastProfile>
#include<surferFlowNoise>

// Opaque coastal ocean shading with depth color, wave crest foam, and a broken
// moving run-up band at the world-space shoreline.

varying vWorld: vec3f;
varying vNormal: vec3f;
varying vViewDist: f32;
varying vSpacing: f32;

var skyLUT: texture_2d<f32>;
var skyLUTSampler: sampler;

uniform cameraPos: vec3f;
uniform oceanTime: f32;
uniform shorelineZ: f32;
uniform coastlineVariation: f32;
uniform waterLevel: f32;
uniform oceanColorSpan: f32;
uniform shoreFoamStrength: f32;
uniform wakePosition: vec2f;
uniform wakeForward: vec2f;
uniform wakeActivity: f32;
uniform wakeSpeed: f32;
uniform sunDir: vec3f;
uniform sunRadiance: vec3f;

uniform waveHeightScale: f32;
uniform waveSpeedScale: f32;

fn dirToLatLong(d: vec3f) -> vec2f {
    let u = atan2(d.x, d.z) / (2.0 * PI) + 0.5;
    let v = acos(clamp(d.y, -1.0, 1.0)) / PI;
    return vec2f(u, v);
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    // The sea occupies the +Z side of the fixed coastline. Discarding in the
    // fragment stage keeps the edge at the exact world-space shoreline even
    // when the camera-following grid shifts.
    let shoreline = coastShorelineZ(
        input.vWorld.x, uniforms.shorelineZ, uniforms.coastlineVariation
    );
    if (input.vWorld.z < shoreline) { discard; }

    let world = input.vWorld;
    let V = normalize(uniforms.cameraPos - world);
    var N = normalize(input.vNormal);
    let waveNormal = N;

    // Pixel-scale, directional ripples keep the distant, coarsened clipmap from
    // reading as a perfectly smooth plate. Derivatives and clipmap spacing both
    // fade detail before it aliases in the far rings.
    let p = world.xz;
    let t = uniforms.oceanTime * uniforms.waveSpeedScale;
    let waveHeight = world.y - uniforms.waterLevel;
    // Two broad, crossing swells bend the fine reflections independently.
    // They affect shading only; the rendered surface remains the same field
    // used by the CPU sampler, so geometry and shoreline stay in agreement.
    let swellPhase0 = dot(p, vec2f(0.072, -0.041)) - t * 0.12;
    let swellPhase1 = dot(p, vec2f(-0.034, 0.086)) + t * 0.095;
    let swell0 = sin(swellPhase0);
    let swell1 = sin(swellPhase1 + swell0 * 0.48);
    let warp0 = 1.18 * swell0 + 0.43 * swell1 + waveHeight * 0.72;
    let warp1 = -0.52 * swell0 + 0.88 * swell1 + waveHeight * 0.46;
    let r0 = dot(p, vec2f(0.74, 1.0)) * 1.65 - t * 2.8 + warp0;
    let r1 = dot(p, vec2f(-1.0, 0.48)) * 2.35 + t * 3.6 + warp1;
    let pixelFootprint = max(length(dpdx(p)), length(dpdy(p)));
    let detailFade = (1.0 - smoothstep(2.0, 8.0, input.vSpacing))
        * (1.0 - smoothstep(0.28, 1.1, pixelFootprint * 2.35));
    // Slowly varied amplitudes keep the reflected facets from repeating as a
    // uniform crosshatch. Clipmap and pixel-footprint filtering still remove
    // these details before the outer rings become unstable.
    let facet0 = 0.82 + 0.18 * sin(dot(p, vec2f(0.031, 0.052)) - t * 0.16);
    let facet1 = 0.78 + 0.22 * sin(dot(p, vec2f(-0.046, 0.027)) + t * 0.13);
    let detail = vec2f(cos(r0) * 0.025 * facet0 + cos(r1) * 0.014 * facet1,
                       cos(r0) * 0.034 * facet0 - cos(r1) * 0.019 * facet1)
        * detailFade;
    N = normalize(N + vec3f(detail.x, 0.0, detail.y));

    let NdotV = clamp(dot(N, V), 0.02, 1.0);
    let shoreDistance = max(world.z - shoreline, 0.0);
    let depthBlend = smoothstep(0.0, max(uniforms.oceanColorSpan, 1.0), shoreDistance);
    let shallow = vec3f(0.025, 0.37, 0.32);
    let deep = vec3f(0.007, 0.075, 0.18);
    var color = mix(shallow, deep, depthBlend);

    // Nearshore suspended-sand scattering shifts the shallow water toward a
    // muted green teal. The broad wave height also adds restrained light/shade
    // variation, tied to the actual displaced surface rather than a screen effect.
    let nearshoreScatter = 1.0 - smoothstep(2.0, 58.0, shoreDistance);
    color = mix(color, vec3f(0.065, 0.40, 0.30), nearshoreScatter * 0.24);
    color *= 1.0 + clamp(waveHeight * 0.045, -0.055, 0.055);

    // The analytic sky LUT provides environment reflections without an extra
    // scene-color copy or another render pass.
    let reflected = reflect(-V, N);
    let sky = textureSampleLevel(
        skyLUT, skyLUTSampler, dirToLatLong(reflected), 0.5
    ).rgb;
    let fresnel = 0.02 + 0.96 * pow(1.0 - NdotV, 5.0);
    let skyFill = textureSampleLevel(skyLUT, skyLUTSampler, vec2f(0.5, 0.08), 2.0).rgb;
    let waterLight = uniforms.sunRadiance * max(0.0, uniforms.sunDir.y) * 0.20
        + skyFill * 0.30;
    color *= waterLight;
    color = mix(color, sky, fresnel * 0.96);

    let L = normalize(uniforms.sunDir);
    let H = normalize(V + L);
    let specAngle = max(dot(N, H), 0.0);
    let broadGlint = pow(specAngle, 36.0) * 0.045;
    let tightGlint = pow(specAngle, 176.0) * 0.24;
    color += uniforms.sunRadiance * (broadGlint + tightGlint);

    // Broken foam on incoming shallow-water waves.
    let breakup = clamp(
        0.63
        + 0.20 * sin(world.x * 1.45 + world.z * 2.1 - t * 2.2
            + waveHeight * 2.8 + waveNormal.x * 3.0)
        + 0.17 * sin(world.x * 0.64 - world.z * 3.7 + t * 3.1
            + waveHeight * 4.1 + waveNormal.z * 2.2),
        0.0, 1.0
    );

    // The vertex stage already exports displaced height and its matching
    // normal. Use both to break foam along raised, steeper wave crests instead
    // of drawing only a shoreline-parallel stripe.
    let crestHeight = smoothstep(0.34, 0.78, waveHeight / max(0.05, uniforms.waveHeightScale))
        * smoothstep(0.0, 0.15, uniforms.waveHeightScale);
    let crestSlope = smoothstep(0.025, 0.16, length(waveNormal.xz));
    let crestMask = crestHeight * mix(0.34, 1.0, crestSlope);
    let crestBreakup = clamp(
        0.68
        + 0.18 * sin(world.x * 0.39 + world.z * 0.25 - t * 1.1
            + waveHeight * 2.0 + waveNormal.x * 2.4)
        + 0.14 * sin(world.x * 0.91 - world.z * 0.53 + t * 1.8
            + waveHeight * 3.2 + waveNormal.z * 1.8),
        0.0, 1.0
    );
    let shoreSwash = coastSwashFoam(p, shoreDistance, t, pixelFootprint);
    let breakingPhase = shoreDistance * 0.28 + t * 0.88 + world.x * 0.034;
    let breaker = pow(max(0.0, sin(breakingPhase)), 12.0)
        * smoothstep(2.0, 5.0, shoreDistance)
        * (1.0 - smoothstep(14.0, 28.0, shoreDistance));
    let cells = noise2(p * 2.6 + vec2f(t * 0.18, -t * 0.31));
    let foam = clamp(
        max(max(shoreSwash, breaker * breakup), crestMask * crestBreakup)
            * uniforms.shoreFoamStrength * (0.82 + cells * 0.28),
        0.0, 1.0
    );
    let foamColor = vec3f(0.90, 0.96, 1.0) * (
        uniforms.sunRadiance * max(0.0, uniforms.sunDir.y) / PI + skyFill * 0.70
    );
    color = mix(color, foamColor, foam * 0.92);

    // A transient V-shaped foam trail follows the surfer. It is evaluated as
    // part of the water material, so there is no per-frame wake mesh upload.
    let forward = normalize(uniforms.wakeForward);
    let right = vec2f(forward.y, -forward.x);
    let rel = world.xz - uniforms.wakePosition;
    let along = dot(rel, forward);
    let behind = -along;
    let lateral = abs(dot(rel, right));
    let spread = 0.18 + behind * mix(0.075, 0.12, clamp(uniforms.wakeSpeed / 19.5, 0.0, 1.0));
    let waveEdge = spread + 0.075 * sin(behind * 0.82 - t * 2.2 + world.x * 0.07);
    let edgeWidth = 0.15 + behind * 0.018;
    let edgeDistance = abs(lateral - waveEdge);
    let wakeLine = 1.0 - smoothstep(edgeWidth, edgeWidth + 0.46, edgeDistance);
    let wakeTail = smoothstep(0.25, 1.1, behind) * (1.0 - smoothstep(11.0, 19.0, behind));
    let wakeBreakup = clamp(
        0.58
        + 0.22 * sin(world.x * 2.1 + world.z * 1.3 - t * 5.2)
        + 0.20 * sin(world.x * 4.4 - world.z * 2.7 + t * 3.7),
        0.0, 1.0
    );
    let wakeFoam = clamp(
        wakeLine * wakeTail * wakeBreakup * uniforms.wakeActivity
            * uniforms.shoreFoamStrength,
        0.0, 1.0
    );
    color = mix(color, foamColor, wakeFoam * 0.82);

    // The camera far plane is 4.2 km, so blend the water into the sky before it
    // reaches that clipping distance. The outer clipmap edge sits just beyond
    // the default far plane and follows the player without geometry uploads.
    let ray = normalize(world - uniforms.cameraPos);
    let horizonDir = normalize(vec3f(ray.x, max(ray.y, 0.025), ray.z));
    let horizonSky = textureSampleLevel(
        skyLUT, skyLUTSampler, dirToLatLong(horizonDir), 0.0
    ).rgb;
    let farFade = smoothstep(3200.0, 4100.0, input.vViewDist);
    color = mix(color, horizonSky, farFade);

    fragmentOutputs.color = vec4f(color, 1.0);
}
