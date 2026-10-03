/** Random stars sampled uniformly on a sphere, baked once into a sky atlas. */
export function makeStarField(width = 2048, height = 1024, count = 4800) {
    const pixels = new Uint8Array(width * height * 4);
    let seed = 0x51f047;
    const random = () => {
        seed += 0x6d2b79f5;
        let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < count; i++) {
        // Uniform cos(theta), rather than uniform latitude, avoids polar bands.
        const y = random() * 2 - 1;
        const theta = Math.acos(y);
        const cx = random() * width;
        const cy = theta / Math.PI * height;
        const radius = 0.45 + random() * 0.45;
        const rx = radius / Math.max(0.025, Math.sin(theta));
        const ry = radius;
        const brightness = 90 + random() * 165;
        const phase = Math.floor(random() * 255);
        const rate = Math.floor(random() * 255);
        for (let py = Math.max(0, Math.floor(cy - ry * 2)); py <= Math.min(height - 1, Math.ceil(cy + ry * 2)); py++) {
            for (let px = Math.floor(cx - rx * 2); px <= Math.ceil(cx + rx * 2); px++) {
                const dx = (px + 0.5 - cx) / rx;
                const dy = (py + 0.5 - cy) / ry;
                const intensity = Math.round(brightness * Math.exp(-2.4 * (dx * dx + dy * dy)));
                const wrappedX = ((px % width) + width) % width;
                const index = (py * width + wrappedX) * 4;
                if (intensity <= pixels[index]) continue;
                pixels[index] = intensity;
                pixels[index + 1] = phase;
                pixels[index + 2] = rate;
                pixels[index + 3] = 255;
            }
        }
    }
    return pixels;
}
