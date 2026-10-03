#include<coastProfile>

// Depth-prepass fragment stage for the ocean. The G channel stays zero so SSR
// continues to ignore the ocean until a water-specific reflection pass exists.

varying vWorld: vec3f;
varying vViewZ: f32;

uniform shorelineZ: f32;
uniform coastlineVariation: f32;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let shoreline = coastShorelineZ(
        input.vWorld.x, uniforms.shorelineZ, uniforms.coastlineVariation
    );
    if (input.vWorld.z < shoreline) { discard; }
    if (input.vViewZ <= 0.0) { discard; }
    fragmentOutputs.color = vec4f(input.vViewZ, 0.0, 0.0, 1.0);
}
