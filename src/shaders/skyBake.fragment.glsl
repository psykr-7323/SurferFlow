#version 300 es
precision highp float;
precision highp int;
layout(location = 0) out vec4 fragColor;
#include<surferFlowSelection>

in vec2 vUV;
uniform vec3 sunDir;
uniform float sunIntensity;
uniform vec3 groundBounce;
// Bakes the atmospheric scattering integral into an equirectangular LUT.
// Re-run only when the sun moves, never per frame.

#include<surferFlowNoise>
#include<surferFlowAtmosphere>


void main() {
    vec3 dir = latLongToDir(vUV);
    // A stable coastal gradient supplies the same radiance to the visible sky,
    // SH ambient, water reflections and fog. Its inexpensive bake keeps the
    // lighting responsive while the day/night clock runs.
    float daylight = smoothstep(-0.10, 0.18, sunDir.y);
    // Dawn/dusk begins before the disc reaches the horizon and persists after.
    float twilight = exp(-pow(sunDir.y / 0.17, 2.0));
    float dome = pow(clamp(dir.y, 0.0, 1.0), 0.45);
    vec3 day = mix(vec3(0.30, 0.42, 0.56), vec3(0.045, 0.15, 0.34), dome)
        * sunIntensity * 0.50;
    vec3 night = mix(vec3(0.035, 0.045, 0.075), vec3(0.008, 0.014, 0.038), dome);
    float towardSun = pow(max(0.0, dot(dir, normalize(vec3(sunDir.x, 0.08, sunDir.z)))), 8.0);
    float horizon = exp(-abs(dir.y) * 7.0);
    vec3 col = mix(night, day, daylight);
    vec3 warmHorizon = mix(vec3(0.46, 0.11, 0.025), vec3(0.72, 0.28, 0.075), daylight);
    col += warmHorizon * sunIntensity
        * twilight * horizon * (0.16 + towardSun * 0.84);
    // Violet twilight opposite the sun gives the entire dome a gradual transition.
    col += vec3(0.095, 0.045, 0.17) * sunIntensity
        * twilight * exp(-abs(dir.y - 0.16) * 4.0) * (1.0 - towardSun) * 0.36;
    vec3 ground = max(groundBounce, vec3(0.014, 0.018, 0.025));
    col = mix(ground, col, smoothstep(-0.12, 0.02, dir.y));

    // The solar disc itself. Kept out of nishitaSky so the IBL projection can
    // use the same LUT without a 100,000x spike blowing out the SH fit.
    fragColor = vec4(col, 1.0);
}
