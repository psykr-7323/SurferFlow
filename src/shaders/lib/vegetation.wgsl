// Shared coastal-plant motion. The camera-depth and light-depth passes call
// this exact function so moving leaves cast and occlude at their visible pose.
uniform vegetationTime: f32;
uniform vegetationWindDir: vec2f;
uniform vegetationWindStrength: f32;

fn bendVegetation(world: vec3f, root: vec3f) -> vec3f {
    let height = max(world.y - root.y, 0.0);
    let phase = dot(root.xz, vec2f(0.071, 0.053)) + uniforms.vegetationTime * 1.55;
    let gust = sin(phase) * 0.72 + sin(phase * 0.57 + 1.7) * 0.28;
    let bend = gust * min(height * 0.105, 0.52) * uniforms.vegetationWindStrength;
    return world + vec3f(uniforms.vegetationWindDir.x, 0.0, uniforms.vegetationWindDir.y) * bend;
}
