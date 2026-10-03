// Bakes the atmospheric scattering integral into an equirectangular LUT.
// Re-run only when the sun moves, never per frame.

#include<rideNoise>
#include<rideAtmosphere>

varying vUV: vec2f;

uniform sunDir: vec3f;
uniform sunIntensity: f32;
uniform groundBounce: vec3f;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let dir = latLongToDir(input.vUV);
    // A stable coastal gradient supplies the same radiance to the visible sky,
    // SH ambient, water reflections and fog. Its inexpensive bake keeps the
    // lighting responsive while the day/night clock runs.
    let daylight = smoothstep(-0.10, 0.18, uniforms.sunDir.y);
    let twilight = (1.0 - smoothstep(0.04, 0.32, abs(uniforms.sunDir.y)))
        * smoothstep(-0.24, -0.02, uniforms.sunDir.y);
    let dome = pow(clamp(dir.y, 0.0, 1.0), 0.45);
    let day = mix(vec3f(0.30, 0.42, 0.56), vec3f(0.045, 0.15, 0.34), dome)
        * uniforms.sunIntensity * 0.50;
    let night = mix(vec3f(0.035, 0.045, 0.075), vec3f(0.008, 0.014, 0.038), dome);
    let towardSun = pow(max(0.0, dot(dir, normalize(vec3f(uniforms.sunDir.x, 0.08, uniforms.sunDir.z)))), 8.0);
    let horizon = exp(-abs(dir.y) * 7.0);
    var col = mix(night, day, daylight);
    col += vec3f(0.42, 0.14, 0.055) * uniforms.sunIntensity
        * twilight * horizon * (0.25 + towardSun * 0.75);
    let ground = max(uniforms.groundBounce, vec3f(0.014, 0.018, 0.025));
    col = mix(ground, col, smoothstep(-0.12, 0.02, dir.y));

    // The solar disc itself. Kept out of nishitaSky so the IBL projection can
    // use the same LUT without a 100,000x spike blowing out the SH fit.
    fragmentOutputs.color = vec4f(col, 1.0);
}
