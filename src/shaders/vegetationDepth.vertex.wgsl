#include<coastVegetation>
#include<coastProfile>

attribute position: vec3f;
#ifdef INSTANCES
attribute world0: vec4f;
attribute world1: vec4f;
attribute world2: vec4f;
attribute world3: vec4f;
#endif

uniform lightViewProjection: mat4x4f;
uniform world: mat4x4f;
uniform vegetationFocus: vec2f;
uniform vegetationRadius: f32;
uniform shorelineZ: f32;
uniform coastlineVariation: f32;

varying vWorld: vec3f;
varying vEdgeFade: f32;
varying vShorelineZ: f32;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    var finalWorld = uniforms.world;
#ifdef INSTANCES
    finalWorld = mat4x4f(vertexInputs.world0, vertexInputs.world1, vertexInputs.world2, vertexInputs.world3);
#ifdef THIN_INSTANCES
    finalWorld = uniforms.world * finalWorld;
#endif
#endif

    let root = (finalWorld * vec4f(0.0, 0.0, 0.0, 1.0)).xyz;
    let baseWorld = (finalWorld * vec4f(vertexInputs.position, 1.0)).xyz;
    let world = bendVegetation(baseWorld, root);
    vertexOutputs.vWorld = world;
    vertexOutputs.vShorelineZ = coastShorelineZ(
        world.x, uniforms.shorelineZ, uniforms.coastlineVariation
    );
    let focusDistance = distance(world.xz, uniforms.vegetationFocus);
    vertexOutputs.vEdgeFade = 1.0 - smoothstep(uniforms.vegetationRadius * 0.78, uniforms.vegetationRadius, focusDistance);
    vertexOutputs.position = uniforms.lightViewProjection * vec4f(world, 1.0);
}
