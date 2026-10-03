// -----------------------------------------------------------------------------
// surferFlowShadowLookup — the receiving half of the cascaded shadow maps.
//
// Lifted out of the snow material once the character needed the identical
// lookup. Two independent copies of this would be a slow-motion disaster: the
// Y-flip convention, the receiver-plane gradient and the normal offset are all
// things that are invisible to inspection and wrong in ways that only show up
// as "the shadows swim a bit". One include, one convention.
//
// Contract — every material that includes this must declare:
//
//   uniform sunDir: vec3                    (points *toward* the sun)
//   uniform cascadeMatrices: array<mat4, 3>
//   uniform cascadeSplits: vec4
//   uniform cascadeParams: vec4[3](depth range m, ortho width m, -, -)
//   uniform shadowTexel: float
//   uniform shadowSoftness: float
//   uniform shadowBias: float
//   var cascade0/1/2: texture_2d<float> + matching samplers
//
// and must include <surferFlowShading> first, for `pcssShadow`.
// -----------------------------------------------------------------------------

/// Project into one cascade and run PCSS. Returns 1.0 (lit) outside the
/// cascade's extent, so callers can fall through to a coarser one.
float sampleCascadeTex(sampler2D tex, mat4 m, vec4 params, vec3 world, vec3 geoN, float biasWorld, float softness, float noiseRot) {
    float depthRange = params.x;
    float orthoWidth = params.y;
    float texelWorld = orthoWidth * shadowTexel;

    // ---- the light's own basis -------------------------------------------
    // Reconstructed here rather than passed in, so it cannot drift out of sync
    // with the matrix. This mirrors Matrix.LookAtLHToRef in shadows.js exactly:
    // forward is the direction the light travels, right = up x forward, and the
    // world up is only swapped out for a near-zenith sun, which this scene's
    // 0.5-45 degree elevation range never reaches.
    vec3 lf = -sunDir;
    vec3 lr = normalize(cross(vec3(0.0, 1.0, 0.0), lf));
    vec3 lu = cross(lf, lr);

    // Surface normal in that basis. `nl.z` is the cosine between the normal and
    // the light's direction of travel, so it goes to zero exactly at the
    // terminator — where the plane is edge-on to the light and its depth
    // gradient is genuinely infinite. Clamped to a slope of 6 (about 80 degrees),
    // past which extrapolating further would start detaching real shadows from
    // their casters rather than preventing acne.
    vec3 nl = vec3(dot(geoN, lr), dot(geoN, lu), dot(geoN, lf));
    float nz = selectValue(min(nl.z, -1e-3), max(nl.z, 1e-3), nl.z >= 0.0);
    vec2 grad = clamp(vec2(-nl.x / nz, -nl.y / nz), vec2(-6.0), vec2(6.0));

    // Metres of light-space travel per unit UV. Y keeps its sign, because the
    // render-target flip below means v runs *with* light-space Y, not against it.
    vec2 planeNdcPerUV = vec2(grad.x, grad.y) * orthoWidth / depthRange;

    // ---- normal-offset bias ----------------------------------------------
    // Move the receiver off the surface by a texel's worth before projecting,
    // scaled by how obliquely the light meets it. This is what absorbs the
    // depth quantisation of the map itself, and because it is expressed in this
    // cascade's own texels it needs no per-cascade multiplier: 3 cm in cascade 0,
    // where contact shadows must stay attached, and 40 cm out in cascade 2 where
    // a texel covers that much ground anyway.
    float sinL = sqrt(clamp(1.0 - nl.z * nl.z, 0.0, 1.0));
    vec3 biased = world + geoN * (texelWorld * 1.5 * max(sinL, 0.2));

    vec4 clip = m * vec4(biased, 1.0);
    vec3 ndc = clip.xyz / clip.w;
    if(any(greaterThan(abs(ndc.xy), vec2(1.0))) || ndc.z < -1.0 || ndc.z > 1.0) { return 1.0; }

    // WebGL's clip-space depth is [-1,1], while gl_FragCoord.z and the R32F
    // shadow target are [0,1]. The standard OpenGL viewport mapping converts
    // between them. Texture coordinates use the framebuffer's bottom-left
    // origin, so increasing light-space Y also increases V.
    vec2 uv = vec2(ndc.x * 0.5 + 0.5, 0.5 + ndc.y * 0.5);
    float depth = ndc.z * 0.5 + 0.5;

    return pcssShadow(tex, uv, depth, shadowTexel, depthRange, orthoWidth, softness, noiseRot, biasWorld, planeNdcPerUV);
}

/// Pick a cascade and evaluate PCSS, cross-fading over the last 12% of each
/// slice so the filter width never visibly steps.
///
/// The cascades are separate bindings rather than one atlas because GLSL cannot
/// index a texture by a runtime value without binding arrays. The branch costs
/// almost nothing: cascade choice is a function of view distance, so it is
/// coherent across essentially every wavefront.
float sunShadow(vec3 world, vec3 geoN, float viewDist, float noiseRot) {
    // A small constant bias, and nothing else. Slope scaling and per-cascade
    // texel-footprint multipliers are both handled inside `sampleCascadeTex`,
    // exactly and in world units, by the receiver-plane gradient and the
    // texel-sized normal offset. Stacking more on top only peter-pans the
    // shadows off their casters.
    float biasWorld = shadowBias;

    vec4 sp = cascadeSplits;
    float soft = shadowSoftness;

    if(viewDist >= sp.z) { return 1.0; }

    if(viewDist < sp.x) {
        float s = sampleCascadeTex(cascade0, cascadeMatrices[0], cascadeParams[0], world, geoN, biasWorld, soft, noiseRot);
        float blendStart = sp.x * 0.88;
        if(viewDist <= blendStart) { return s; }
        float s2 = sampleCascadeTex(cascade1, cascadeMatrices[1], cascadeParams[1], world, geoN, biasWorld, soft, noiseRot);
        return mix(s, s2, clamp((viewDist - blendStart) / (sp.x - blendStart), 0.0, 1.0));
    }

    if(viewDist < sp.y) {
        float s = sampleCascadeTex(cascade1, cascadeMatrices[1], cascadeParams[1], world, geoN, biasWorld, soft, noiseRot);
        float blendStart = sp.y * 0.88;
        if(viewDist <= blendStart) { return s; }
        float s2 = sampleCascadeTex(cascade2, cascadeMatrices[2], cascadeParams[2], world, geoN, biasWorld, soft, noiseRot);
        return mix(s, s2, clamp((viewDist - blendStart) / (sp.y - blendStart), 0.0, 1.0));
    }

    float s = sampleCascadeTex(cascade2, cascadeMatrices[2], cascadeParams[2], world, geoN, biasWorld, soft, noiseRot);
    // Fade the last cascade out at its far edge rather than cutting to lit.
    return mix(s, 1.0, smoothstep(sp.z * 0.85, sp.z, viewDist));
}
