uniform float vegetationTime;
uniform vec2 vegetationWindDir;
uniform float vegetationWindStrength;
// Shared coastal-plant motion. The camera-depth and light-depth passes call
// this exact function so moving leaves cast and occlude at their visible pose.


vec3 bendVegetation(vec3 world, vec3 root) {
    float height = max(world.y - root.y, 0.0);
    float phase = dot(root.xz, vec2(0.071, 0.053)) + vegetationTime * 1.55;
    float gust = sin(phase) * 0.72 + sin(phase * 0.57 + 1.7) * 0.28;
    float bend = gust * min(height * 0.105, 0.52) * vegetationWindStrength;
    return world + vec3(vegetationWindDir.x, 0.0, vegetationWindDir.y) * bend;
}
