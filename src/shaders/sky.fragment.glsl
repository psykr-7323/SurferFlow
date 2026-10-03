#version 300 es
precision highp float;
precision highp int;
layout(location = 0) out vec4 fragColor;
#include<surferFlowSelection>

in vec3 vDir;
uniform sampler2D skyLUT;
uniform sampler2D starAtlas;
uniform vec3 sunDir;
uniform vec3 solarDir;
uniform float daylight;
uniform float nightAmount;
uniform vec3 sunColor;
uniform float sunIntensity;
uniform float time;
uniform vec2 windDir;
uniform float cloudAmount;
uniform vec3 cameraPosition;
uniform vec3 sunRadiance;
uniform vec4 shR[9];
uniform float ambientIntensity;
uniform float ridgeAmp;
uniform float fogDensity;
uniform float fogHeightFalloff;
uniform float fogStart;
uniform float aerialStrength;
#include<surferFlowNoise>
#include<surferFlowAtmosphere>
#include<surferFlowShading>
#include<surferFlowRidge>


/// Direct solar irradiance at the ground, on the same scale the LUT stores
/// radiance in — so the range is lit by the identical number the snow is.


/// Peak height of the far range, metres. Zero switches it off entirely.


// The field's own aerial perspective, so the range can be hazed by the same
// atmosphere the snow in front of it is. See `shadeRidge`.


/// Shade a point on the far range.
///
/// Deliberately the *snow field's* material logic, not a separate one: the same
/// wrapped diffuse, the same SH ambient, the same near-white albedo that is
/// never 1.0. A distant mountain rendered with its own ad-hoc lighting is the
/// classic way a matte painting announces itself — it does not sit in the same
/// light as the ground in front of it.
vec3 shadeRidge(RidgeHit hit, vec3 dir) {
    vec3 N = hit.normal;
    vec3 L = sunDir;

    // Snow almost everywhere, rock only on the faces too steep to hold it. This
    // is a polar range, not an alpine one: there is no snow line to speak of, and
    // the first version's 120-460 m ramp put rock across the whole visible band
    // and turned the horizon into a dark smear. Rock is here for the *break* it
    // gives a white massif, not as a ground cover.
    float steep = 1.0 - N.y;
    float surferFlowMask = clamp(1.0 - smoothstep(0.46, 0.80, steep), 0.0, 1.0);

    vec3 rock = vec3(0.052, 0.055, 0.066);
    vec3 snow = vec3(0.50, 0.36, 0.20);
    vec3 albedo = mix(rock, snow, surferFlowMask);

    float shadow = ridgeShadow(hit.pos, hit.height, L, ridgeAmp);

    const float INV_PI = 0.31830988618;
    float diff = wrapDiffuse(dot(N, L), mix(0.15, 0.62, surferFlowMask));
    vec3 col = albedo * INV_PI * sunRadiance * diff * shadow;

    // --- subsurface ---------------------------------------------------------
    // The term the first version left out, and the reason the range read as a
    // different material from the field it stands behind.
    //
    // Snow is translucent. The snow shader spends most of its budget saying so,
    // and a mountain of snow with the sun behind it *glows* — it does not go to a
    // dark silhouette. Without this the range came out as dark warm shapes
    // against bright warm haze, which is the one combination that reads as dirt,
    // and it was most visible in exactly the framing where a range should look
    // its best: looking into a low sun.
    //
    // Same `surferFlowSubsurface` the ground runs, so the two cannot disagree about
    // what back-lit snow does.
    vec3 V = -dir;
    col += surferFlowSubsurface(N, L, V, sunRadiance, 0.45, surferFlowMask, 1.0)
         * albedo * mix(0.5, 1.0, shadow);

    // Sky fill. At this distance it is most of what is left after extinction,
    // and it is the reason distant snow reads blue rather than grey.
    col += albedo * INV_PI * shIrradiance(N, shR) * ambientIntensity;

    // Bounce off the range's own snow, exactly as the field does off itself. A
    // white massif is lit from every direction by the rest of the massif, and
    // leaving it out is what makes shaded faces read as too dark by a stop.
    col += albedo * INV_PI * shIrradiance(vec3(0.0, 1.0, 0.0), shR)
         * ambientIntensity * 0.30 * clamp(-N.y * 0.5 + 0.5, 0.0, 1.0)
         * surferFlowMask;

    // ---- aerial perspective ------------------------------------------------
    //
    // The scene's own, not a second atmosphere of the range's own — and that
    // change is most of what makes the range sit *in* the landscape rather than
    // behind it.
    //
    // Deliberately *not* a second, physically-real atmosphere integrated over
    // the true kilometres. That gives the frame two different atmospheres and
    // the seam lands exactly where the eye is looking: the scene's haze is
    // roughly a hundred times thicker than real air, so an 800 m dune is hazed
    // as though it were eighty kilometres away while a 20 km massif gets a
    // genuine 20 km of it — and the range comes out sharper and more contrasty
    // than the ground in front of it, which reads as a matte painting hung
    // behind the set.
    //
    // What makes one atmosphere work at these distances is the height falloff
    // the field's fog already has: at 0.045 per metre the haze has a 22 m scale
    // height, so a summit at two kilometres sits almost entirely clear of it
    // while its own feet are buried. On the current settings a 2 km peak keeps
    // about two thirds of its contrast at 9 km and a fifth at 35 km, and
    // anything below ~300 m is gone by 8 km — peaks emerging from a sea of
    // haze, on the same curve the dunes 600 m away are already on.
    vec3 hitPos = vec3(hit.pos.x, hit.height, hit.pos.y);
    float t = aerialTransmittance(cameraPosition, hitPos, fogDensity, fogHeightFalloff, fogStart);
    float ext = clamp(1.0 - pow(t, aerialStrength), 0.0, 1.0);

    // The identical inscatter the ground converges to. This is the part that has
    // to match exactly: the clipmap's far edge and the range's feet are adjacent
    // pixels in the frame, and if they resolve to two different "fully hazed"
    // colours there is a visible line between them whatever else is right. At
    // full extinction it is the plain sky lookup, which is what this shader draws
    // where the march missed — so a fully hazed massif and the sky beside it are
    // literally the same value.
    vec3 inscatter = aerialInscatterSky(skyLUT, dir, L, sunRadiance, ext);

    return mix(col, inscatter, ext);
}


void main() {
    vec3 dir = normalize(vDir);
    vec2 uv = dirToLatLong(dir);

    vec3 col = textureLod(skyLUT, uv, 0.0).rgb;

    // ------------------------------------------------------- far-field range
    // Above the band the march's ceiling test rejects immediately, so the upper
    // bound is only there to skip the call.
    //
    // The lower bound reaches well *below* the horizon on purpose, and an earlier
    // version's did not. Fading the range out at a fixed elevation angle drew a
    // dead straight horizontal line under the whole massif — a ruler across the
    // frame, which is the one thing a landscape never has. A real range's feet are
    // hidden by the land in front of it, and here that happens for free: the
    // clipmap is drawn *after* the sky and covers everything below its own
    // silhouette, so letting the range paint down past the horizon lets the near
    // dunes occlude it exactly where they actually stand. A ray at -0.05 from eye
    // height meets the ground inside eighty metres, so there is nowhere it can
    // escape the terrain and show a base.
    if(ridgeAmp > 1.0 && dir.y < 0.230 && dir.y > -0.050) {
        RidgeHit hit = ridgeMarch(cameraPosition, dir, ridgeAmp);
        if(hit.hit) {
            col = shadeRidge(hit, dir);
        }
    }

    // ---------------------------------------------------------- solar disc
    // ~0.53 degrees across, with limb darkening. The glow around it is the
    // aureole: forward-scattered light in the first few degrees, which at this
    // sun elevation is a large part of why the horizon reads warm.
    float mu = dot(dir, solarDir);
    float discRadius = 0.009;
    float discCos = cos(discRadius);
    if(mu > discCos && solarDir.y > -0.015) {
        float r = sqrt(max(0.0, 1.0 - mu * mu)) / discRadius;
        float limb = pow(max(0.0, 1.0 - r * r * 0.72), 0.42);
        col += sunColor * sunIntensity * 32.0 * limb
            * smoothstep(-0.015, 0.015, solarDir.y);
    }
    float aureole = pow(max(0.0, mu), 1400.0) * 5.5 + pow(max(0.0, mu), 64.0) * 0.28;
    col += sunColor * sunIntensity * aureole * 0.18 * daylight;

    // The moon takes over the direct light, reflections and shadow direction.
    float moonMu = dot(dir, -solarDir);
    float moonEdge = smoothstep(cos(0.010), cos(0.008), moonMu);
    float moonTexture = 0.72 + noise2(dir.xz * 580.0) * 0.20;
    float moonrise = smoothstep(-0.015, 0.025, -solarDir.y);
    col += vec3(1.2, 1.5, 2.0) * moonEdge * moonTexture * nightAmount * moonrise;
    col += vec3(0.08, 0.11, 0.20) * pow(max(0.0, moonMu), 600.0)
        * nightAmount * moonrise;
    // Seeded random spherical positions avoid float-hash bands and grid centres.
    vec4 starData = textureLod(starAtlas, uv, 0.0);
    float twinkle = 0.76 + 0.18 * sin(time * (1.1 + starData.b * 2.4)
        + starData.g * 91.0) + 0.06 * sin(time * 4.7 + starData.g * 163.0);
    col += vec3(1.2, 1.5, 2.1) * starData.r * twinkle * nightAmount
        * smoothstep(0.02, 0.20, dir.y);

    // ------------------------------------------------------------- cirrus
    // Thin, high, wind-aligned. Restrained on purpose: the reference skies are
    // mostly clean gradient, and clouds here exist to stop the upper sky from
    // being a flat wash, not to become subject matter.
    if(cloudAmount > 0.001 && dir.y > 0.0) {
        // Project onto a high plane so bands converge at the horizon.
        float planeY = 1.0 / max(0.06, dir.y);
        vec2 cp = dir.xz * planeY * 0.5 + windDir * time * 0.004;

        // Stretch across the wind so the streaks run with it.
        float a = atan(windDir.x, windDir.y);
        cp = rot2(a) * cp;
        cp.x *= 0.28;

        float n = fbmd(cp, 4, 2.13, 0.52).x;
        float cloud = smoothstep(0.06, 0.34, n);
        // Fade out at the horizon and at the zenith.
        cloud *= smoothstep(0.0, 0.22, dir.y) * (1.0 - smoothstep(0.55, 1.0, dir.y) * 0.45);
        cloud *= cloudAmount;

        // Lit from below-ish by a low sun, so the underside catches warmth.
        float sunLit = pow(max(0.0, mu * 0.5 + 0.5), 3.0);
        vec3 cloudCol = mix(vec3(0.52, 0.60, 0.74), sunColor * 1.35, sunLit * 0.75);
        vec3 cloudLight = mix(vec3(0.04, 0.055, 0.085), cloudCol * 8.0, daylight);
        col = mix(col, cloudLight, cloud * 0.50);
    }

    fragColor = vec4(col, 1.0);
}
