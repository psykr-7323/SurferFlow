/**
 * Procedural character geometry.
 *
 * Nothing here is authored in a DCC tool. Every surface is a lofted tube, a
 * swept ring or a Bezier-blended shell evaluated from the bind-pose skeleton, so
 * the whole figure is a few hundred lines of tables and a smooth-normal pass.
 *
 * Three meshes share skinned-body and cloth vertex programs:
 *
 *   body   linearly blend-skinned — skin, linen top, shorts, hair and sunglasses.
 *   cloth  driven from the simulated garment grids, sampled with Catmull-Rom in
 *          the vertex shader so a 24x14 solve renders as a smooth surface.
 *   board  a static rounded deck, skinned to its own level surf bone; it tracks
 *          the rider without inheriting torso pitch and shares the same passes.
 *
 * Normals are never derived analytically. Everything is built as positions plus
 * indices and then run through one area-weighted smooth-normal pass, which is
 * both less code and immune to the sign errors that analytic normals on a swept
 * surface invite. Closed rings share their seam vertex rather than duplicating
 * it, so the seam is smooth too.
 *
 * Build time only — none of this runs after load, and it allocates freely.
 */

import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import {
    B_ROOT, B_BOARD, B_SPINE, B_CHEST, B_NECK, B_HEAD,
    B_UPPER_L, B_FORE_L, B_HAND_L, B_UPPER_R, B_FORE_R, B_HAND_R,
    B_THIGH_L, B_SHIN_L, B_FOOT_L, B_THIGH_R, B_SHIN_R, B_FOOT_R,
} from "./figure.js";

// ------------------------------------------------------------- material slots
export const M_SHORTS = 0;     // teal board shorts
export const M_LINEN = 1;   // cream linen top
export const M_CREAM = 2;    // pale cream under-layer
export const M_FRAME = 3;  // sunglasses frame and board fins
export const M_SKIN = 4;     // sun-warmed skin
export const M_BLUE_ACCENT = 5;     // blue lenses and shorts trim
export const M_HAIR = 6;      // brown hair
export const M_BOARD = 7;    // hard-coated surfboard deck

/** Segments around a limb. 14 is smooth at the distances this is seen from. */
const SEG = 14;

// -----------------------------------------------------------------------------

class Builder {
    constructor() {
        this.pos = [];
        this.nrm = [];
        this.uv = [];
        /** (matId, ao) on the body; (shellT, ao) on the fur. */
        this.aux = [];
        this.bi = [];       // bone indices, 4 per vertex
        this.bw = [];       // bone weights, 4 per vertex
        this.idx = [];
        /** Fur supplies its own normals; everything else has them derived. */
        this.explicitNormals = false;
    }

    /** @returns {number} the new vertex's index */
    vert(x, y, z, u, v, matId, ao, b0, w0, b1, w1) {
        this.pos.push(x, y, z);
        this.nrm.push(0, 0, 0);
        this.uv.push(u, v);
        this.aux.push(matId, ao);
        this.bi.push(b0, b1 || 0, 0, 0);
        this.bw.push(w0, w1 || 0, 0, 0);
        return this.pos.length / 3 - 1;
    }

    normal(vi, x, y, z) {
        this.nrm[vi * 3] = x;
        this.nrm[vi * 3 + 1] = y;
        this.nrm[vi * 3 + 2] = z;
    }

    tri(a, b, c) {
        this.idx.push(a, b, c);
    }

    quad(a, b, c, d) {
        // Both diagonals of every quad get used across the mesh, alternating is
        // not worth the bookkeeping on shapes this smooth.
        this.idx.push(a, b, c, a, c, d);
    }
}

/**
 * Area-weighted smooth normals.
 *
 * Area weighting rather than plain averaging: a long thin triangle at a cap
 * would otherwise pull the pole normal off toward its own plane.
 */
function computeNormals(pos, idx) {
    const n = new Float32Array(pos.length);
    for (let i = 0; i < idx.length; i += 3) {
        const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
        const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
        const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
        // Un-normalised cross product: its length is twice the triangle area,
        // which is exactly the weight we want.
        const fx = uy * vz - uz * vy;
        const fy = uz * vx - ux * vz;
        const fz = ux * vy - uy * vx;
        n[a] += fx; n[a + 1] += fy; n[a + 2] += fz;
        n[b] += fx; n[b + 1] += fy; n[b + 2] += fz;
        n[c] += fx; n[c + 1] += fy; n[c + 2] += fz;
    }
    for (let i = 0; i < n.length; i += 3) {
        const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
        n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
    }
    return n;
}

/**
 * Loft a closed tube through a list of rings.
 *
 * Each ring is `[cx, cy, cz, rx, rz, ao, b0, w0, b1, w1]` and the cross-section
 * plane is derived from the direction to the neighbouring rings, so a limb that
 * bends in the bind pose still gets circular sections rather than sheared ones.
 *
 * @param {Builder} B
 * @param {number[][]} rings
 * @param {number} matId
 * @param {[number,number,number]} ref reference axis the section frame avoids
 */
function loft(B, rings, matId, ref, capStart, capEnd) {
    const n = rings.length;
    const first = [];
    let prevRow = null;
    let vAcc = 0;

    for (let r = 0; r < n; r++) {
        const cur = rings[r];
        const prev = rings[Math.max(0, r - 1)];
        const next = rings[Math.min(n - 1, r + 1)];

        let ax = next[0] - prev[0], ay = next[1] - prev[1], az = next[2] - prev[2];
        let al = Math.hypot(ax, ay, az) || 1;
        ax /= al; ay /= al; az /= al;

        // U = axis x ref, W = axis x U — the two axes of the section plane.
        let ux = ay * ref[2] - az * ref[1];
        let uy = az * ref[0] - ax * ref[2];
        let uz = ax * ref[1] - ay * ref[0];
        let ul = Math.hypot(ux, uy, uz) || 1;
        ux /= ul; uy /= ul; uz /= ul;
        const wx = ay * uz - az * uy;
        const wy = az * ux - ax * uz;
        const wz = ax * uy - ay * ux;

        if (r > 0) {
            vAcc += Math.hypot(cur[0] - prev[0], cur[1] - prev[1], cur[2] - prev[2]);
        }

        // Texture coordinates are metres of surface, not normalised. Every
        // scale in the fabric shader — the weave, the yarn slub — is a physical
        // size, and normalised UVs would make each of them a different size on
        // every part of the body.
        const circ = Math.PI * (cur[3] + cur[4]);

        const row = [];
        for (let s = 0; s < SEG; s++) {
            const a = (s / SEG) * Math.PI * 2;
            const ca = Math.cos(a), sa = Math.sin(a);
            const px = cur[0] + ux * cur[3] * sa + wx * cur[4] * ca;
            const py = cur[1] + uy * cur[3] * sa + wy * cur[4] * ca;
            const pz = cur[2] + uz * cur[3] * sa + wz * cur[4] * ca;
            row.push(B.vert(
                px, py, pz,
                (s / SEG) * circ, vAcc,
                matId, cur[5], cur[6], cur[7], cur[8], cur[9]
            ));
        }

        if (prevRow) {
            for (let s = 0; s < SEG; s++) {
                const s2 = (s + 1) % SEG;
                B.quad(prevRow[s], prevRow[s2], row[s2], row[s]);
            }
        }
        if (r === 0) first.push(...row);
        prevRow = row;
    }

    // Caps: a fan to a centre vertex placed on the ring's own axis.
    if (capStart) capRing(B, rings[0], rings[1], first, matId, true);
    if (capEnd) capRing(B, rings[n - 1], rings[n - 2], prevRow, matId, false);
}

function capRing(B, ring, neighbour, row, matId, isStart) {
    let ax = ring[0] - neighbour[0], ay = ring[1] - neighbour[1], az = ring[2] - neighbour[2];
    const al = Math.hypot(ax, ay, az) || 1;
    ax /= al; ay /= al; az /= al;
    const ext = Math.max(ring[3], ring[4]) * 0.7;
    const c = B.vert(
        ring[0] + ax * ext, ring[1] + ay * ext, ring[2] + az * ext,
        0.5, 0.5, matId, ring[5], ring[6], ring[7], ring[8], ring[9]
    );
    for (let s = 0; s < SEG; s++) {
        const s2 = (s + 1) % SEG;
        if (isStart) B.tri(c, row[s2], row[s]);
        else B.tri(c, row[s], row[s2]);
    }
}

/** Bone blend along the spine, by bind-pose height. */
function spineBones(y) {
    if (y < 1.06) {
        const t = Math.min(1, Math.max(0, (y - 0.88) / 0.18));
        return [B_ROOT, 1 - t * 0.5, B_SPINE, t * 0.5];
    }
    if (y < 1.26) {
        const t = (y - 1.06) / 0.20;
        return [B_SPINE, 1 - t, B_CHEST, t];
    }
    const t = Math.min(1, (y - 1.26) / 0.20);
    return [B_CHEST, 1 - t * 0.35, B_NECK, t * 0.35];
}

/** Ring helper: `[cx,cy,cz, rx,rz, ao, b0,w0,b1,w1]`. */
function ring(cx, cy, cz, rx, rz, ao, bones) {
    return [cx, cy, cz, rx, rz, ao, bones[0], bones[1], bones[2], bones[3]];
}

/** Rings along a straight bone segment, interpolating radius and bone weights. */
function limbRings(x0, y0, z0, x1, y1, z1, r0, r1, steps, boneA, boneB, ao, from, to) {
    const out = [];
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        // Weight ramps from boneA to boneB across the segment's lower half, so
        // the joint bends smoothly instead of creasing at one ring.
        const w = Math.min(1, Math.max(0, (t - from) / (to - from)));
        const r = r0 + (r1 - r0) * t;
        out.push(ring(
            x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t,
            r, r, ao, [boneA, 1 - w, boneB, w]
        ));
    }
    return out;
}

// -----------------------------------------------------------------------------
//  Body
// -----------------------------------------------------------------------------

/** Beach rider: uncovered face, bare limbs, board shorts and sunglasses. */
export function buildBody(scene) {
    const B = new Builder();
    // Open shirt hem avoids a pointed linen cap protruding below the waist.
    const torso = [[0.94, 0.153, 0.124], [1.08, 0.146, 0.115],
        [1.26, 0.180, 0.126], [1.38, 0.180, 0.120], [1.44, 0.140, 0.105]];
    loft(B, torso.map(([y, rx, rz]) => ring(0, y, 0, rx, rz, 0.94, spineBones(y))),
        M_LINEN, [0, 0, 1], false, true);
    // Continuous waist/seat shell covers the gap between the two leg tubes.
    // Root weighting keeps it attached to the pelvis as the thighs spread.
    loft(B, [ring(0, 0.99, 0, 0.170, 0.143, 0.96, [B_ROOT, 1, 0, 0]),
        ring(0, 0.93, -0.003, 0.184, 0.152, 0.95, [B_ROOT, 1, 0, 0]),
        ring(0, 0.84, -0.005, 0.190, 0.153, 0.95, [B_ROOT, 1, 0, 0]),
        ring(0, 0.78, 0, 0.175, 0.143, 0.94, [B_ROOT, 1, 0, 0])],
        M_SHORTS, [0, 0, 1], false, true);
    loft(B, [ring(0, 1.43, 0, 0.059, 0.057, 0.90, [B_NECK, 1, 0, 0]),
        ring(0, 1.56, 0.005, 0.058, 0.057, 0.93, [B_HEAD, 1, 0, 0])],
        M_SKIN, [0, 0, 1], false, false);
    const head = [];
    for (let i = 0; i <= 10; i++) {
        const a = i / 10 * Math.PI;
        const r = Math.sin(a);
        head.push(ring(0, 1.655 - Math.cos(a) * 0.108, 0.009,
            0.088 * r + 0.003, 0.094 * r + 0.003, 0.94, [B_HEAD, 1, 0, 0]));
    }
    loft(B, head, M_SKIN, [0, 0, 1], true, true);
    // Rounded nose and ears keep the uncovered face readable from the side.
    loft(B, [ring(0, 1.65, 0.092, 0.015, 0.015, 0.95, [B_HEAD, 1, 0, 0]),
        ring(0, 1.68, 0.111, 0.010, 0.012, 0.95, [B_HEAD, 1, 0, 0])],
        M_SKIN, [0, 0, 1], true, true);
    for (const side of [-1, 1]) {
        loft(B, [ring(side * 0.089, 1.638, 0, 0.019, 0.020, 0.88, [B_HEAD, 1, 0, 0]),
            ring(side * 0.093, 1.676, 0, 0.019, 0.020, 0.93, [B_HEAD, 1, 0, 0])],
            M_SKIN, [0, 0, 1], true, true);
    }
    // Brown swept hair; its raised crown is visible in the chase camera.
    loft(B, [ring(0, 1.705, -0.018, 0.091, 0.096, 0.90, [B_HEAD, 1, 0, 0]),
        ring(-0.006, 1.746, -0.026, 0.100, 0.102, 0.95, [B_HEAD, 1, 0, 0]),
        ring(-0.025, 1.790, -0.037, 0.078, 0.081, 0.96, [B_HEAD, 1, 0, 0]),
        ring(-0.035, 1.818, -0.043, 0.028, 0.038, 0.94, [B_HEAD, 1, 0, 0])],
        M_HAIR, [0, 0, 1], false, true);
    // Sunglasses have separate frames, recessed blue lenses and temple arms.
    for (const side of [-1, 1]) {
        block(B, side * 0.048, 1.676, 0.103, 0.046, 0.029, 0.012, M_FRAME, B_HEAD);
        block(B, side * 0.048, 1.676, 0.117, 0.034, 0.019, 0.003, M_BLUE_ACCENT, B_HEAD);
        block(B, side * 0.093, 1.677, 0.035, 0.008, 0.009, 0.080, M_FRAME, B_HEAD);
    }
    block(B, 0, 1.677, 0.113, 0.014, 0.006, 0.006, M_FRAME, B_HEAD);

    for (let side = 0; side < 2; side++) {
        const sign = side === 0 ? -1 : 1;
        const up = side === 0 ? B_UPPER_L : B_UPPER_R;
        const fore = side === 0 ? B_FORE_L : B_FORE_R;
        const hand = side === 0 ? B_HAND_L : B_HAND_R;
        loft(B, limbRings(sign * 0.185, 1.400, 0, sign * 0.230, 1.123, 0,
            0.061, 0.041, 5, up, fore, 0.93, 0.72, 1.0), M_SKIN, [0, 0, 1], true, false);
        loft(B, limbRings(sign * 0.230, 1.123, 0, sign * 0.243, 0.866, 0.016,
            0.045, 0.031, 5, fore, hand, 0.95, 0.75, 1.0), M_SKIN, [0, 0, 1], false, false);
        loft(B, [ring(sign * 0.243, 0.866, 0.016, 0.035, 0.029, 0.95, [hand, 1, 0, 0]),
            ring(sign * 0.247, 0.810, 0.025, 0.042, 0.027, 0.95, [hand, 1, 0, 0]),
            ring(sign * 0.248, 0.768, 0.035, 0.030, 0.022, 0.93, [hand, 1, 0, 0])],
            M_SKIN, [0, 0, 1], false, true);

        const th = side === 0 ? B_THIGH_L : B_THIGH_R;
        const sh = side === 0 ? B_SHIN_L : B_SHIN_R;
        const ft = side === 0 ? B_FOOT_L : B_FOOT_R;
        loft(B, limbRings(sign * 0.100, 0.90, 0, sign * 0.100, 0.46, 0,
            0.079, 0.055, 6, th, sh, 0.94, 0.74, 1.0), M_SKIN, [0, 0, 1], true, false);
        loft(B, [ring(sign * 0.100, 0.94, 0, 0.119, 0.132, 0.96, [B_ROOT, 0.75, th, 0.25]),
            ring(sign * 0.100, 0.82, 0.005, 0.119, 0.130, 0.96, [B_ROOT, 0.25, th, 0.75]),
            ring(sign * 0.100, 0.63, 0.006, 0.101, 0.105, 0.93, [th, 1, 0, 0])],
            M_SHORTS, [0, 0, 1], false, false);
        loft(B, [ring(sign * 0.100, 0.63, 0.006, 0.102, 0.106, 0.95, [th, 1, 0, 0]),
            ring(sign * 0.100, 0.65, 0.006, 0.103, 0.107, 0.95, [th, 1, 0, 0])],
            M_BLUE_ACCENT, [0, 0, 1], false, false);
        loft(B, [ring(sign * 0.100, 0.46, 0, 0.055, 0.056, 0.93, [sh, 1, 0, 0]),
            ring(sign * 0.100, 0.34, 0.005, 0.063, 0.062, 0.96, [sh, 1, 0, 0]),
            ring(sign * 0.100, 0.22, 0.004, 0.045, 0.047, 0.94, [sh, 1, 0, 0]),
            ring(sign * 0.100, 0.10, 0, 0.032, 0.035, 0.92, [ft, 1, 0, 0])],
            M_SKIN, [0, 0, 1], false, false);
        loft(B, [ring(sign * 0.100, 0.041, -0.068, 0.035, 0.037, 0.90, [ft, 1, 0, 0]),
            ring(sign * 0.100, 0.042, 0.005, 0.046, 0.040, 0.96, [ft, 1, 0, 0]),
            ring(sign * 0.100, 0.036, 0.10, 0.049, 0.031, 0.95, [ft, 1, 0, 0]),
            ring(sign * 0.100, 0.030, 0.17, 0.039, 0.023, 0.94, [ft, 1, 0, 0])],
            M_SKIN, [0, 1, 0], true, true);
    }
    return finishSkinned(scene, "rideBody", B);
}

/** Small hard-edged accessory, sharing the existing skinning passes. */
function block(B, x, y, z, rx, ry, rz, material, bone) {
    const corners = [[-1,-1,-1], [1,-1,-1], [1,1,-1], [-1,1,-1],
        [-1,-1,1], [1,-1,1], [1,1,1], [-1,1,1]];
    for (const face of [[0,3,2,1], [4,5,6,7], [0,4,7,3], [1,2,6,5], [3,7,6,2], [0,1,5,4]]) {
        const row = face.map((index, corner) => {
            const c = corners[index];
            return B.vert(x+c[0]*rx, y+c[1]*ry, z+c[2]*rz,
                corner === 1 || corner === 2 ? 0.08 : 0, corner >= 2 ? 0.04 : 0,
                material, 0.98, bone, 1, 0, 0);
        });
        B.quad(...row);
    }
}

/**
 * A compact, rounded surfboard carried by its own pose bone.
 *
 * The planform is built from cross-sections rather than a box, with a slight
 * deck crown, rocker and rounded rails. Its long axis follows the rider's
 * forward (+Z) axis while surfing; the pose solver carries it upright behind
 * the figure, angled broadside toward the opening camera, while walking. A
 * narrow contrasting stringer and three small fins add detail without an
 * authored asset.
 */
export function buildSurfboard(scene) {
    const B = new Builder();
    const stations = [
        [-0.88, 0.012], [-0.82, 0.064], [-0.68, 0.129], [-0.48, 0.182],
        [-0.24, 0.216], [0.00, 0.228], [0.24, 0.216], [0.48, 0.182],
        [0.68, 0.129], [0.82, 0.064], [0.88, 0.012],
    ];
    const across = [-1, -0.52, 0, 0.52, 1];
    const centerY = 0.13;
    const thickness = 0.042;
    const top = [];
    const bottom = [];

    for (let i = 0; i < stations.length; i++) {
        const [z, width] = stations[i];
        const rocker = 0.028 * (z / 0.88) * (z / 0.88);
        const topRow = [];
        const bottomRow = [];
        for (let j = 0; j < across.length; j++) {
            const q = across[j];
            const x = q * width;
            const rail = Math.abs(q);
            const crown = width > 0.001 ? (1 - rail * rail) * 0.009 : 0;
            const yTop = centerY + rocker + crown;
            const yBottom = yTop - thickness * (1 - 0.12 * rail);
            const u = z + 0.88;
            const v = x + 0.20;
            topRow.push(B.vert(x, yTop, z, u, v, M_BOARD, 0.95, B_BOARD, 1, 0, 0));
            bottomRow.push(B.vert(x, yBottom, z, u, v, M_BOARD, 0.85, B_BOARD, 1, 0, 0));
        }
        top.push(topRow);
        bottom.push(bottomRow);
    }

    // Deck normals face up; the underside is wound the other way.
    for (let i = 0; i < stations.length - 1; i++) {
        for (let j = 0; j < across.length - 1; j++) {
            B.quad(top[i][j], top[i + 1][j], top[i + 1][j + 1], top[i][j + 1]);
            B.quad(bottom[i][j], bottom[i][j + 1], bottom[i + 1][j + 1], bottom[i + 1][j]);
        }
        // Rounded left and right rails join the crowned deck to the underside.
        B.quad(top[i][0], bottom[i][0], bottom[i + 1][0], top[i + 1][0]);
        const last = across.length - 1;
        B.quad(top[i][last], top[i + 1][last], bottom[i + 1][last], bottom[i][last]);
    }

    // Nose and tail close into a rounded point at each end.
    for (const i of [0, stations.length - 1]) {
        for (let j = 0; j < across.length - 1; j++) {
            if (i === 0) B.quad(top[i][j], top[i][j + 1], bottom[i][j + 1], bottom[i][j]);
            else B.quad(top[i][j], bottom[i][j], bottom[i][j + 1], top[i][j + 1]);
        }
    }

    // Subtle raised center stringer. It is a separate material region, so the
    // deck shader keeps a clean hard-coat response instead of interpolating IDs.
    const stringer = [];
    for (const [z] of stations) {
        const rocker = 0.028 * (z / 0.88) * (z / 0.88);
        const y = centerY + rocker + 0.009 + 0.0015;
        stringer.push([
            B.vert(-0.013, y, z, z + 0.88, 0.187, M_BLUE_ACCENT, 0.96, B_BOARD, 1, 0, 0),
            B.vert(0.013, y, z, z + 0.88, 0.213, M_BLUE_ACCENT, 0.96, B_BOARD, 1, 0, 0),
        ]);
    }
    for (let i = 0; i < stringer.length - 1; i++) {
        B.quad(stringer[i][0], stringer[i + 1][0], stringer[i + 1][1], stringer[i][1]);
    }

    // Three simple swept fins under the rear (-Z) tail. Their dark material
    // separates them from the board and helps the silhouette read from above.
    for (const x of [-0.095, 0, 0.095]) {
        const a = B.vert(x, centerY - thickness, -0.58, 0, 0, M_FRAME, 0.88, B_BOARD, 1, 0, 0);
        const b = B.vert(x, centerY - thickness, -0.77, 0.2, 0, M_FRAME, 0.88, B_BOARD, 1, 0, 0);
        const c = B.vert(x, centerY - thickness - 0.105, -0.70, 0.12, 0.1, M_FRAME, 0.88, B_BOARD, 1, 0, 0);
        B.tri(a, b, c);
    }

    return finishSkinned(scene, "surfboard", B);
}

function finishSkinned(scene, name, B, isFur) {
    const pos = new Float32Array(B.pos);
    const idx = new Uint32Array(B.idx);
    const nrm = B.explicitNormals ? new Float32Array(B.nrm) : computeNormals(pos, idx);

    const mesh = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = pos;
    vd.indices = idx;
    vd.normals = nrm;
    vd.uvs = new Float32Array(B.uv);
    vd.applyToMesh(mesh, false);

    mesh.setVerticesData("aux", new Float32Array(B.aux), false, 2);
    mesh.setVerticesData("boneIdx", new Float32Array(B.bi), false, 4);
    mesh.setVerticesData("boneWt", new Float32Array(B.bw), false, 4);

    // The mesh is placed entirely by the vertex shader from bone matrices, so
    // its world matrix is the identity for ever and its bounding box is a lie.
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    mesh.doNotSyncBoundingInfo = true;
    mesh.metadata = { triangles: idx.length / 3, vertices: pos.length / 3, fur: !!isFur };
    return mesh;
}

// -----------------------------------------------------------------------------
//  Cloth render mesh
// -----------------------------------------------------------------------------

/**
 * The render mesh for the simulated garments.
 *
 * It carries no positions of its own — `position` is `(u, v, panelIndex)` and
 * the vertex shader reconstructs the surface by Catmull-Rom interpolation of the
 * panel's simulated node grid. That decoupling is what lets a 24x14 verlet solve
 * render as a smooth 48x28 surface, and it means the sim cost is independent of
 * how finely the garment is tessellated.
 *
 * @param {import("./cloth.js").ClothPanel[]} panels
 */
export function buildClothMesh(scene, panels) {
    const pos = [];
    const uv = [];
    const aux = [];
    const idx = [];

    for (let pi = 0; pi < panels.length; pi++) {
        const p = panels[pi];
        const cu = p.renderCols;
        const cv = p.renderRows;
        const base = pos.length / 3;

        for (let j = 0; j <= cv; j++) {
            const v = j / cv;
            for (let i = 0; i <= cu; i++) {
                const u = i / cu;
                pos.push(u, v, pi);
                uv.push(u * p.weaveU, v * p.weaveV);
                // (matId, ao). Garments darken toward the hem, where they sit in
                // their own folds and close to the ground.
                aux.push(p.matId, p.aoTop + (p.aoBottom - p.aoTop) * v);
            }
        }

        const stride = cu + 1;
        for (let j = 0; j < cv; j++) {
            for (let i = 0; i < cu; i++) {
                const a = base + j * stride + i;
                const b = a + 1;
                const c = a + stride;
                const d = c + 1;
                idx.push(a, b, d, a, d, c);
            }
        }
    }

    const mesh = new Mesh("charCloth", scene);
    const vd = new VertexData();
    vd.positions = new Float32Array(pos);
    vd.indices = new Uint32Array(idx);
    vd.uvs = new Float32Array(uv);
    vd.applyToMesh(mesh, false);
    mesh.setVerticesData("aux", new Float32Array(aux), false, 2);

    mesh.alwaysSelectAsActiveMesh = true;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    mesh.doNotSyncBoundingInfo = true;
    mesh.metadata = { triangles: idx.length / 3, vertices: pos.length / 3 };
    return mesh;
}
