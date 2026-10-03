/** Shared solar clock. Six is sunrise, twelve is noon, eighteen is sunset. */
export function solarPosition(hour) {
    const wrapped = ((hour % 24) + 24) % 24;
    // A tilted circular orbit: east at dawn, south at noon, west at dusk.
    // The opposite point gives the moon the same continuous nightly arc.
    const phase = (wrapped - 6) * Math.PI / 12;
    const x = Math.cos(phase);
    const y = Math.sin(phase) * Math.sin(Math.PI / 3);
    const z = -Math.sin(phase) * Math.cos(Math.PI / 3);
    return {
        azimuth: ((Math.atan2(x, z) * 180 / Math.PI) + 360) % 360,
        elevation: Math.asin(y) * 180 / Math.PI,
    };
}

export function smooth01(a, b, value) {
    const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
    return t * t * (3 - 2 * t);
}

export function advanceClock(hour, dt, minutesPerDay) {
    return ((hour + Math.max(0, dt) * 24 / (Math.max(1, minutesPerDay) * 60)) % 24 + 24) % 24;
}
