/**
 * Raw input state. Everything lands in one mutable struct that systems poll —
 * no events fired into game code, no per-frame allocation.
 *
 * Mouse look uses pointer lock. Space jumps on land and water; Shift increases movement speed.
 */

export const input = {
    // Movement axes, camera-relative, already normalised to a unit disc.
    moveX: 0,
    moveZ: 0,
    moving: false,

    // Accumulated mouse delta since last `endFrame()`, in radians.
    lookX: 0,
    lookY: 0,

    // Zoom, consumed by the camera rig.
    zoomDelta: 0,

    jumpPressed: false, // one press, cleared after the frame
    sprint: false, // Shift on land and water

    locked: false,
};

const keys = Object.create(null);

const LOOK_SCALE = 0.0022;

/**
 * @param {HTMLCanvasElement} canvas
 */
export function initInput(canvas) {
    let dragging = false;
    let lastX = 0, lastY = 0;
    canvas.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        dragging = true;
        lastX = e.clientX; lastY = e.clientY;
    });
    document.addEventListener("mouseup", () => { dragging = false; });
    canvas.addEventListener("click", () => {
        if (!input.locked) {
            // Embedded browsers can reject pointer lock; drag-look still works.
            try { canvas.requestPointerLock()?.catch(() => {}); } catch { /* drag fallback */ }
        }
    });

    document.addEventListener("pointerlockchange", () => {
        input.locked = document.pointerLockElement === canvas;
        if (!input.locked) {
            // Drop held state so the character doesn't run off while unfocused.
            for (const k in keys) keys[k] = false;
            input.jumpPressed = false;
            input.sprint = false;

        }
    });

    document.addEventListener("mousemove", (e) => {
        if (!input.locked && !dragging) return;
        const dx = input.locked ? e.movementX : e.clientX - lastX;
        const dy = input.locked ? e.movementY : e.clientY - lastY;
        lastX = e.clientX; lastY = e.clientY;
        input.lookX += dx * LOOK_SCALE;
        input.lookY += dy * LOOK_SCALE;
    });

    document.addEventListener(
        "wheel",
        (e) => {
            if (!input.locked) return;
            e.preventDefault();
            input.zoomDelta += e.deltaY * 0.0016;
        },
        { passive: false }
    );

    window.addEventListener("keydown", (e) => {
        if (e.code === "Space" && input.locked) e.preventDefault();
        if (e.repeat) return;
        keys[e.code] = true;
        if (e.code === "Space") input.jumpPressed = true;

    });

    window.addEventListener("keyup", (e) => {
        if (e.code === "Space" && input.locked) e.preventDefault();
        keys[e.code] = false;

    });

    window.addEventListener("blur", () => {
        for (const k in keys) keys[k] = false;
        input.jumpPressed = false;
        input.sprint = false;

    });
}

/** Resolve held keys into movement axes. Called once per frame before update. */
export function pollInput() {
    let x = 0;
    let z = 0;
    if (keys.KeyW || keys.ArrowUp) z += 1;
    if (keys.KeyS || keys.ArrowDown) z -= 1;
    if (keys.KeyD || keys.ArrowRight) x += 1;
    if (keys.KeyA || keys.ArrowLeft) x -= 1;

    // Clamp to a unit disc so diagonals aren't faster.
    const len = Math.sqrt(x * x + z * z);
    if (len > 1) {
        x /= len;
        z /= len;
    }
    input.moveX = x;
    input.moveZ = z;
    input.moving = len > 0.001;
    input.sprint = !!(keys.ShiftLeft || keys.ShiftRight);
}

/** Clear per-frame accumulators. Called at the very end of the frame. */
export function endFrame() {
    input.lookX = 0;
    input.lookY = 0;
    input.zoomDelta = 0;

    input.jumpPressed = false;
}

export function isDown(code) {
    return !!keys[code];
}
