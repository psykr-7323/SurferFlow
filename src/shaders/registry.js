/**
 * Registers every GLSL source into Babylon's shader store.
 *
 * Shared libraries go in as `#include<...>` fragments so the coast profile is
 * identical in terrain beauty, shadow and depth passes. Whole shaders go in
 * under the names Babylon expects: `<name>VertexShader` and `<name>PixelShader`.
 *
 * Import this once, before any material is constructed.
 */

import { ShaderStore } from "@babylonjs/core/Engines/shaderStore";

import selectionLib from "./lib/selection.glsl?raw";
import noiseLib from "./lib/noise.glsl?raw";
import terrainLib from "./lib/terrain.glsl?raw";
import shadingLib from "./lib/shading.glsl?raw";
import shadowLookupLib from "./lib/shadowLookup.glsl?raw";
import atmosphereLib from "./lib/atmosphere.glsl?raw";
import clipmapLib from "./lib/clipmap.glsl?raw";
import deformLib from "./lib/deform.glsl?raw";
import charSkinLib from "./lib/charSkin.glsl?raw";
import wakeLib from "./lib/wake.glsl?raw";
import spellLightsLib from "./lib/spellLights.glsl?raw";
import waterLib from "./lib/water.glsl?raw";
import crystalLib from "./lib/crystal.glsl?raw";
import postCommonLib from "./lib/postCommon.glsl?raw";
import ridgeLib from "./lib/ridge.glsl?raw";
import coastLib from "./lib/coast.glsl?raw";
import vegetationLib from "./lib/vegetation.glsl?raw";

import skyBakeFrag from "./skyBake.fragment.glsl?raw";
import deformSimFrag from "./deformSim.fragment.glsl?raw";

import surferFlowVert from "./terrain.vertex.glsl?raw";
import coastFrag from "./coast.fragment.glsl?raw";
import depthVert from "./terrainDepth.vertex.glsl?raw";
import depthFrag from "./terrainDepth.fragment.glsl?raw";
import skyVert from "./sky.vertex.glsl?raw";
import skyFrag from "./sky.fragment.glsl?raw";

import charVert from "./char.vertex.glsl?raw";
import charFrag from "./char.fragment.glsl?raw";
import clothVert from "./cloth.vertex.glsl?raw";
import charDepthVert from "./charDepth.vertex.glsl?raw";
import clothDepthVert from "./clothDepth.vertex.glsl?raw";
import furVert from "./fur.vertex.glsl?raw";
import furFrag from "./fur.fragment.glsl?raw";
import sprayVert from "./spray.vertex.glsl?raw";
import sprayFrag from "./spray.fragment.glsl?raw";
import wakeVert from "./wake.vertex.glsl?raw";
import wakeFrag from "./wake.fragment.glsl?raw";
import wakeDepthVert from "./wakeDepth.vertex.glsl?raw";
import wakeDepthFrag from "./wakeDepth.fragment.glsl?raw";
import waterVert from "./water.vertex.glsl?raw";
import waterFrag from "./water.fragment.glsl?raw";
import crystalVert from "./crystal.vertex.glsl?raw";
import crystalFrag from "./crystal.fragment.glsl?raw";
import crystalDepthVert from "./crystalDepth.vertex.glsl?raw";
import vegetationVert from "./vegetation.vertex.glsl?raw";
import vegetationPrepassVert from "./vegetationPrepass.vertex.glsl?raw";
import vegetationDepthVert from "./vegetationDepth.vertex.glsl?raw";
import vegetationFrag from "./vegetation.fragment.glsl?raw";
import vegetationPrepassFrag from "./vegetationPrepass.fragment.glsl?raw";
import vegetationDepthFrag from "./vegetationDepth.fragment.glsl?raw";

import prepassFrag from "./prepass.fragment.glsl?raw";
import terrainPrepassVert from "./terrainPrepass.vertex.glsl?raw";
import terrainPrepassFrag from "./terrainPrepass.fragment.glsl?raw";
import charPrepassVert from "./charPrepass.vertex.glsl?raw";
import clothPrepassVert from "./clothPrepass.vertex.glsl?raw";
import wakePrepassVert from "./wakePrepass.vertex.glsl?raw";
import wakePrepassFrag from "./wakePrepass.fragment.glsl?raw";
import crystalPrepassVert from "./crystalPrepass.vertex.glsl?raw";


const INCLUDES = {
    surferFlowSelection: selectionLib,
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
