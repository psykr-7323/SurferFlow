#include<coastVegetation>
#include<coastProfile>

attribute position: vec3f;
attribute normal: vec3f;
attribute color: vec4f;
#ifdef INSTANCES
attribute world0: vec4f;
attribute world1: vec4f;
attribute world2: vec4f;
attribute world3: vec4f;
#endif

uniform viewProjection: mat4x4f;
uniform world: mat4x4f;
uniform cameraPos: vec3f;
uniform vegetationFocus: vec2f;
uniform vegetationRadius: f32;
uniform shorelineZ: f32;
uniform coastlineVariation: f32;

varying vWorld: vec3f;
varying vNormal: vec3f;
varying vColor: vec4f;
varying vViewDist: f32;
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
    let normalMatrix = mat3x3f(finalWorld[0].xyz, finalWorld[1].xyz, finalWorld[2].xyz);
    let normal = normalize(normalMatrix * vertexInputs.normal);
    let viewDistance = distance(world, uniforms.cameraPos);
    let focusDistance = distance(world.xz, uniforms.vegetationFocus);

    vertexOutputs.vWorld = world;
    vertexOutputs.vNormal = normal;
    vertexOutputs.vColor = vertexInputs.color;
    vertexOutputs.vViewDist = viewDistance;
    vertexOutputs.vEdgeFade = 1.0 - smoothstep(uniforms.vegetationRadius * 0.78, uniforms.vegetationRadius, focusDistance);
    vertexOutputs.vShorelineZ = coastShorelineZ(
        world.x, uniforms.shorelineZ, uniforms.coastlineVariation
    );
    vertexOutputs.position = uniforms.viewProjection * vec4f(world, 1.0);
}
