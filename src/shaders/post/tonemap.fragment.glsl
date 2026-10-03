#version 300 es
precision highp float;
precision highp int;
layout(location = 0) out vec4 fragColor;
#include<surferFlowSelection>

in vec2 vUV;
uniform sampler2D textureSampler;
uniform sampler2D bloomNear;
uniform sampler2D bloomFar;
uniform sampler2D shaftsTex;
uniform float exposure;
uniform float contrast;
uniform float mode;
uniform float grainAmount;
uniform float time;
uniform float vignette;
uniform float bloomAmount;
uniform float shaftAmount;
// -----------------------------------------------------------------------------
// The composite: shafts, bloom, exposure, the display transform, grain.
//
// Everything that has to happen in one place happens here, because each of these
// is defined relative to the one before it. Shafts are radiance and go in before
// exposure; bloom is thresholded in *exposed* units so its knee means something
// fixed; contrast is applied in linear so it pushes into the tone curve's
// shoulder rather than clipping after it; grain goes on after the encode so it
// reads evenly across the range instead of vanishing in the shadows.
//
// Snow renders die at the tonemapper. The scene is a huge, bright, low-contrast
// surface, so any curve that saturates early turns the whole field into a flat
// white sheet with no form — the single most common failure in snow rendering.
//
// AgX is the default here rather than ACES for exactly that reason: it desaturates
// toward white as it approaches the shoulder instead of hue-shifting, and its
// shoulder is long enough that a sunlit drift at 6x middle grey still has legible
// gradation instead of clipping to 1.0. ACES is offered for comparison and does
// visibly worse on this content — it pushes bright snow toward a warm cast and
// crushes the last stop.
// -----------------------------------------------------------------------------


/// Quarter-resolution bright pass — the tight glow around a glint or the sun.


/// Sixteenth-resolution, blurred — the broad halo that reads as atmosphere.


       // 0 = AgX, 1 = ACES, 2 = none




// ------------------------------------------------------------------ AgX

const mat3 AGX_IN = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051, 0.0784335999999992, 0.878468636469772, 0.0784336, 0.0792237451477643, 0.0791661274605434, 0.879142973793104);

const mat3 AGX_OUT = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438, -0.0980208811401368, 1.15190312990417, -0.0980434501171241, -0.0990297440797205, -0.0989611768448433, 1.15107367264116);

/// Sixth-order fit of the AgX contrast curve.
vec3 agxContrast(vec3 x) {
    vec3 x2 = x * x;
    vec3 x4 = x2 * x2;
    return 15.5 * x4 * x2
         - 40.14 * x4 * x
         + 31.96 * x4
         - 6.868 * x2 * x
         + 0.4298 * x2
         + 0.1191 * x
         - 0.00232;
}

vec3 agx(vec3 color) {
    const float MIN_EV = -12.47393;
    const float MAX_EV = 4.026069;

    vec3 v = AGX_IN * max(color, vec3(0.0));
    v = clamp(log2(max(v, vec3(1e-10))), vec3(MIN_EV), vec3(MAX_EV));
    v = (v - MIN_EV) / (MAX_EV - MIN_EV);
    return agxContrast(v);
}

/// Gentle saturation recovery. AgX deliberately desaturates highlights; without
/// a little of it back, the cool shadow / warm light split the whole look rests
/// on gets flattened out along with the clipping it was there to prevent.
vec3 agxLook(vec3 color, float sat) {
    vec3 lw = vec3(0.2126, 0.7152, 0.0722);
    float l = dot(color, lw);
    return max(vec3(0.0), l + (color - l) * sat);
}

// ------------------------------------------------------------------ ACES

vec3 acesFitted(vec3 x) {
    float a = 2.51;
    float b = 0.03;
    float c = 2.43;
    float d = 0.59;
    float e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3(0.0), vec3(1.0));
}

// -----------------------------------------------------------------------------

vec3 linearToSrgb(vec3 c) {
    vec3 lo = c * 12.92;
    vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
    return selectValue(hi, lo, lessThanEqual(c, vec3(0.0031308)));
}

void main() {
    vec3 c = texture(textureSampler, vUV).rgb;

    // Light shafts, in scene radiance so the tone curve rolls them off with
    // everything else. Added rather than blended: a shaft is light arriving at
    // the lens along a path, not a surface that replaces what is behind it.
    if(shaftAmount > 0.0001) {
        c += textureLod(shaftsTex, vUV, 0.0).rgb
           * shaftAmount;
    }

    c *= exposure;

    // Bloom. Both levels are already in exposed units — the prefilter applied the
    // same exposure before thresholding, which is what lets the knee sit at a
    // fixed 1.0 instead of chasing the exposure slider.
    if(bloomAmount > 0.0001) {
        vec3 near = textureLod(bloomNear, vUV, 0.0).rgb;
        vec3 far = textureLod(bloomFar, vUV, 0.0).rgb;
        // Weighted toward the wide level: a tight halo on a snow field reads as a
        // rendering artefact, a broad one reads as glare in the air.
        c += (near * 0.35 + far * 0.65) * bloomAmount;
    }

    // Contrast about middle grey, applied in linear before the curve so it
    // pushes into the tonemapper's shoulder rather than clipping after it.
    if(abs(contrast - 1.0) > 0.001) {
        c = 0.18 * pow(max(c / 0.18, vec3(1e-5)), vec3(contrast));
    }

    // Every branch below returns *display-linear*, ready for one sRGB encode.
    vec3 mapped;
    if(mode < 0.5) {
        // AgX's contrast polynomial already emits display-encoded values, so it
        // needs its EOTF (the 2.2 power) applied before the shared sRGB encode
        // at the bottom. Skipping that double-encodes the image: everything
        // lifts toward mid grey and the whole frame goes flat and milky —
        // which on snow is indistinguishable from "the shader is wrong".
        vec3 v = agx(c);
        v = agxLook(v, 1.14);
        mapped = pow(max(AGX_OUT * v, vec3(0.0)), vec3(2.2));
    } else if(mode < 1.5) {
        // The Narkowicz fit is already display-linear.
        mapped = acesFitted(c);
    } else {
        mapped = clamp(c, vec3(0.0), vec3(1.0));
    }

    // Vignette, very slight — enough to keep the eye centred on a scene with no
    // UI to anchor it.
    if(vignette > 0.001) {
        float d = length(vUV - vec2(0.5)) * 1.414;
        mapped *= mix(1.0, smoothstep(1.05, 0.35, d), vignette);
    }

    vec3 outCol = linearToSrgb(mapped);

    // Grain, added after the encode so it reads evenly across the range instead
    // of vanishing in the shadows.
    if(grainAmount > 0.0001) {
        float n = fract(sin(dot(vUV * vec2(1920.0, 1080.0)
                + vec2(time * 91.7, time * 43.3), vec2(12.9898, 78.233))) * 43758.5453);
        outCol += (n - 0.5) * grainAmount;
    }

    fragColor = vec4(outCol, 1.0);
}
