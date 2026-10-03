varying vViewZ: f32;
varying vMask: f32;
varying vEdgeFade: f32;
varying vWorld: vec3f;
varying vShorelineZ: f32;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    if (input.vWorld.z >= input.vShorelineZ - 5.0 || input.vEdgeFade < 0.01) { discard; }
    fragmentOutputs.color = vec4f(input.vViewZ, input.vMask, 0.0, 1.0);
}
