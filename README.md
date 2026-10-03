# SurferFlow

A procedural coastal surf playground built with Babylon.js and WebGL 2. The
shoreline, sand, ocean, plants, rider and surfboard are generated from code.
Shader sources are translated from WGSL to GLSL ES 3.00 by the Vite build plugin.

## Run locally

```sh
npm install
npm run dev
```

Use `npm run build` for a production build, then `npm run preview` to view it.
A browser and graphics device with WebGL 2 support are required.

## Controls

| Input | Action |
|---|---|
| Click the scene | Capture the pointer |
| WASD / arrow keys | Move relative to the camera |
| Mouse / wheel | Look / zoom |
| Space or Shift + movement | Sprint on land |
| Reach the water | Move the board under the feet and begin surfing |
| Space or forward while surfing | Pump for extra speed |
| Backward while surfing | Scrub speed |
| 1–5 | Coastal effects; hold 2 for the ribbon |
| F1 / backtick | Open settings and performance controls |

## Day and night

The scene starts in daylight at 10:00 and runs a twelve-minute day/night cycle.
A full sunrise, daylight, sunset and moonlit night lasts **five minutes** by default.
The sun and moon follow opposite continuous arcs, and stars twinkle at night.

The settings panel exposes **Time of day (hour)**, **Day / night cycle**, and
**Full day / night cycle (minutes)**. Switch the cycle off to keep a chosen time. **Sky
control → manual sun** enables the azimuth and elevation sliders directly.

One shared sky texture drives the visible sky, ambient lighting, reflections,
and atmospheric haze. The sun illuminates the scene by day; the moon and stars
appear at night. Adaptive exposure eases between daylight and night settings,
with a manual exposure multiplier available in the Post group.

## Coast and water

The analytic coast meanders along world X. The positive-Z side of the local
shoreline is water; the land rises into the beach and dunes on the other side.
Terrain and ocean use player-centred clipmaps, keeping geometry bounded as the
rider explores the coast.

Five directional swells displace the water. The CPU height query mirrors their
wavelengths, amplitudes, speeds and shoreline taper so the rider and board
follow the visible surface. Fine normal detail is filtered at a distance.
Shallow teal water deepens offshore and reflects the current sky.

A shared swash front drives foam on the water and wet sand. Breaking bands,
crest foam, and a V-shaped surfer wake add separate motion cues. The foam is
lit by the same daylight or moonlight as the water. Waves smoothly alternate between smaller and larger sets every **30 seconds**.
The same changing height drives the visible water and rider grounding.
F1 exposes the wave-set interval and toggle, wave height,
wave speed, foam strength, wet-sand width and coastline variation.

Grass, dune scrub and coastal trees use deterministic placement in a bounded
window around the rider. Density and visibility are configurable.

## Rider

The procedural rider wears a cream linen sleeveless top and teal board shorts,
with exposed arms and legs, bare feet, brown swept hair and blue sunglasses.
The short shirt hem retains cloth motion without covering the legs. Hair and
accessories share the body skinning, shadow and depth passes. The board moves
from its carried pose to the feet as the rider reaches water.

Locomotion uses a procedural skeleton and planted-foot IK. Animation and cloth
transforms share one small texture upload per frame.

## Rendering and development

- WebGL 2 engine with GLSL ES 3.00 shaders.
- Shared shader includes for coast placement, skinning, shading and shadows.
- Cascaded shadows and a matching depth prepass.
- Temporal antialiasing, bloom, depth of field, tone mapping and sharpening.
- Settings and CPU performance readouts in the F1 panel. GPU timing is unavailable
  on this backend and is displayed as a dash.
- The application inspection handle is `SurferFlow` in the browser console.

Shader uniforms must be registered before a procedural texture compiles. The sky
initialization does this before its first bake so ambient illumination and
reflections receive valid sunlight rather than default zero-valued uniforms.
Sky bakes are throttled and serialized while the clock advances.

```text
src/
  character/    geometry, skeleton, short shirt simulation, sand contact
  core/         input, camera, settings, solar clock, loading, performance
  post/         post-processing chain
  render/       sky, shadows, depth prepass
  shaders/      surfaces, shared includes, effects, post shaders
  spells/       procedural coastal effects
  terrain/      analytic coast, clipmap, local deformation
  ui/           settings and performance panel
  vfx/          particles and wake emitters
  world/        ocean and coastal vegetation
scripts/
  wgslToGlsl.js build-time shader translation
```

Build output is generated in `dist/`. No external textures, character assets or
animation clips are required. The renderer retains procedural effect and
material helpers from the project's earlier prototype.
