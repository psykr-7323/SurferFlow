// Terrain-only camera-depth prepass. The sea side of the clipmap is omitted so
// the matching ocean prepass supplies the animated water depth there.

#include<coastProfile>

varying vViewZ: f32;
varying vMask: f32;
varying vWorld: vec3f;
uniform shorelineZ: f32;
uniform coastlineVariation: f32;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let shoreline = coastShorelineZ(
        input.vWorld.x, uniforms.shorelineZ, uniforms.coastlineVariation
    );
    if (input.vWorld.z >= shoreline) { discard; }
    fragmentOutputs.color = vec4f(input.vViewZ, input.vMask, 0.0, 1.0);
}
