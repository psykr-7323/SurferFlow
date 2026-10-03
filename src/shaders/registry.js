/**
 * Registers every WGSL source into Babylon's shader store.
 *
 * Shared libraries go in as `#include<...>` fragments so the coast profile is
 * identical in terrain beauty, shadow and depth passes. Whole shaders go in
 * under the names Babylon expects: `<name>VertexShader` and `<name>PixelShader`.
 *
 * Import this once, before any material is constructed.
 */

import { ShaderStore } from "@babylonjs/core/Engines/shaderStore";

import noiseLib from "./lib/noise.wgsl?glsl";
import terrainLib from "./lib/terrain.wgsl?glsl";
import shadingLib from "./lib/shading.wgsl?glsl";
import shadowLookupLib from "./lib/shadowLookup.wgsl?glsl";
import atmosphereLib from "./lib/atmosphere.wgsl?glsl";
import clipmapLib from "./lib/clipmap.wgsl?glsl";
import deformLib from "./lib/deform.wgsl?glsl";
import charSkinLib from "./lib/charSkin.wgsl?glsl";
import wakeLib from "./lib/wake.wgsl?glsl";
import spellLightsLib from "./lib/spellLights.wgsl?glsl";
import waterLib from "./lib/water.wgsl?glsl";
import crystalLib from "./lib/crystal.wgsl?glsl";
import postCommonLib from "./lib/postCommon.wgsl?glsl";
import ridgeLib from "./lib/ridge.wgsl?glsl";
import coastLib from "./lib/coast.wgsl?glsl";
import vegetationLib from "./lib/vegetation.wgsl?glsl";

import skyBakeFrag from "./skyBake.fragment.wgsl?glsl";
import deformSimFrag from "./deformSim.fragment.wgsl?glsl";

import surferFlowVert from "./terrain.vertex.wgsl?glsl";
import coastFrag from "./coast.fragment.wgsl?glsl";
import depthVert from "./terrainDepth.vertex.wgsl?glsl";
import depthFrag from "./terrainDepth.fragment.wgsl?glsl";
import skyVert from "./sky.vertex.wgsl?glsl";
import skyFrag from "./sky.fragment.wgsl?glsl";

import charVert from "./char.vertex.wgsl?glsl";
import charFrag from "./char.fragment.wgsl?glsl";
import clothVert from "./cloth.vertex.wgsl?glsl";
import charDepthVert from "./charDepth.vertex.wgsl?glsl";
import clothDepthVert from "./clothDepth.vertex.wgsl?glsl";
import furVert from "./fur.vertex.wgsl?glsl";
import furFrag from "./fur.fragment.wgsl?glsl";
import sprayVert from "./spray.vertex.wgsl?glsl";
import sprayFrag from "./spray.fragment.wgsl?glsl";
import wakeVert from "./wake.vertex.wgsl?glsl";
import wakeFrag from "./wake.fragment.wgsl?glsl";
import wakeDepthVert from "./wakeDepth.vertex.wgsl?glsl";
import wakeDepthFrag from "./wakeDepth.fragment.wgsl?glsl";
import waterVert from "./water.vertex.wgsl?glsl";
import waterFrag from "./water.fragment.wgsl?glsl";
import crystalVert from "./crystal.vertex.wgsl?glsl";
import crystalFrag from "./crystal.fragment.wgsl?glsl";
import crystalDepthVert from "./crystalDepth.vertex.wgsl?glsl";
import vegetationVert from "./vegetation.vertex.wgsl?glsl";
import vegetationPrepassVert from "./vegetationPrepass.vertex.wgsl?glsl";
import vegetationDepthVert from "./vegetationDepth.vertex.wgsl?glsl";
import vegetationFrag from "./vegetation.fragment.wgsl?glsl";
import vegetationPrepassFrag from "./vegetationPrepass.fragment.wgsl?glsl";
import vegetationDepthFrag from "./vegetationDepth.fragment.wgsl?glsl";

import prepassFrag from "./prepass.fragment.wgsl?glsl";
import terrainPrepassVert from "./terrainPrepass.vertex.wgsl?glsl";
import terrainPrepassFrag from "./terrainPrepass.fragment.wgsl?glsl";
import charPrepassVert from "./charPrepass.vertex.wgsl?glsl";
import clothPrepassVert from "./clothPrepass.vertex.wgsl?glsl";
import wakePrepassVert from "./wakePrepass.vertex.wgsl?glsl";
import wakePrepassFrag from "./wakePrepass.fragment.wgsl?glsl";
import crystalPrepassVert from "./crystalPrepass.vertex.wgsl?glsl";


const INCLUDES = {
    surferFlowNoise: noiseLib,
    surferFlowTerrain: terrainLib,
    surferFlowShading: shadingLib,
    surferFlowShadowLookup: shadowLookupLib,
    surferFlowAtmosphere: atmosphereLib,
    surferFlowClipmap: clipmapLib,
    surferFlowDeform: deformLib,
    surferFlowCharSkin: charSkinLib,
    surferFlowWake: wakeLib,
    surferFlowSpellLights: spellLightsLib,
    surferFlowWater: waterLib,
    surferFlowCrystal: crystalLib,
    surferFlowPostCommon: postCommonLib,
    surferFlowRidge: ridgeLib,
    coastProfile: coastLib,
    coastVegetation: vegetationLib,
};

const SHADERS = {
    skyBakePixelShader: skyBakeFrag,
    deformSimPixelShader: deformSimFrag,

    surferFlowVertexShader: surferFlowVert,
    coastPixelShader: coastFrag,

    terrainDepthVertexShader: depthVert,
    terrainDepthPixelShader: depthFrag,

    skyVertexShader: skyVert,
    skyPixelShader: skyFrag,

    charVertexShader: charVert,
    charPixelShader: charFrag,
    clothVertexShader: clothVert,
    charDepthVertexShader: charDepthVert,
    clothDepthVertexShader: clothDepthVert,
    furVertexShader: furVert,
    furPixelShader: furFrag,
    sprayVertexShader: sprayVert,
    sprayPixelShader: sprayFrag,
    wakeVertexShader: wakeVert,
    wakePixelShader: wakeFrag,
    wakeDepthVertexShader: wakeDepthVert,
    wakeDepthPixelShader: wakeDepthFrag,

    waterVertexShader: waterVert,
    waterPixelShader: waterFrag,
    crystalVertexShader: crystalVert,
    crystalPixelShader: crystalFrag,
    crystalDepthVertexShader: crystalDepthVert,
    coastVegetationVertexShader: vegetationVert,
    coastVegetationPixelShader: vegetationFrag,
    coastVegetationPrepassVertexShader: vegetationPrepassVert,
    coastVegetationPrepassPixelShader: vegetationPrepassFrag,
    coastVegetationDepthVertexShader: vegetationDepthVert,
    coastVegetationDepthPixelShader: vegetationDepthFrag,

    // The camera-space depth prepass. One fragment stage shared by everything
    // that has nothing to discard; the wake carries its own because it does.
    prepassPixelShader: prepassFrag,
    terrainPrepassVertexShader: terrainPrepassVert,
    terrainPrepassPixelShader: terrainPrepassFrag,
    charPrepassVertexShader: charPrepassVert,
    clothPrepassVertexShader: clothPrepassVert,
    wakePrepassVertexShader: wakePrepassVert,
    wakePrepassPixelShader: wakePrepassFrag,
    crystalPrepassVertexShader: crystalPrepassVert,
};

let registered = false;

export function registerShaders() {
    if (registered) return;
    registered = true;

    for (const name in INCLUDES) {
        ShaderStore.IncludesShadersStore[name] = INCLUDES[name];
    }
    for (const name in SHADERS) {
        ShaderStore.ShadersStore[name] = SHADERS[name];
    }
}
