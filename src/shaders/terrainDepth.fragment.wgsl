// Writes NDC depth into the cascade atlas as R32F.
//
// Stored as a plain colour rather than sampled from a depth texture so PCSS can
// do its blocker search with ordinary filtered fetches — a comparison sampler
// would only ever hand back a pre-thresholded result, which is the one thing the
// blocker search cannot use.

#include<coastProfile>

#ifdef RIDE_CASCADE
varying vWorld: vec3f;
uniform shorelineZ: f32;
uniform coastlineVariation: f32;
#endif

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
#ifdef RIDE_CASCADE
    let shoreline = coastShorelineZ(
        input.vWorld.x, uniforms.shorelineZ, uniforms.coastlineVariation
    );
    if (input.vWorld.z >= shoreline) { discard; }
#endif
    fragmentOutputs.color = vec4f(input.position.z, 0.0, 0.0, 1.0);
}
