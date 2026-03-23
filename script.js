// ============================================================
//  PIXEL JELLY SANDBOX — Soft-Body Physics Simulation
// ============================================================

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// ---- Pixel scaling for the chunky look ----
const PIXEL_SIZE = 3;
let W, H, bufW, bufH;

function resize() {
    const rect = canvas.getBoundingClientRect();
    W = rect.width;
    H = rect.height;
    canvas.width = W;
    canvas.height = H;
    bufW = Math.ceil(W / PIXEL_SIZE);
    bufH = Math.ceil(H / PIXEL_SIZE);
}
window.addEventListener('resize', resize);
resize();

// ---- Off-screen buffer for pixelation ----
const offCanvas = document.createElement('canvas');
const offCtx = offCanvas.getContext('2d');

function resizeOffscreen() {
    offCanvas.width = bufW;
    offCanvas.height = bufH;
}
resizeOffscreen();
window.addEventListener('resize', resizeOffscreen);

// ---- State ----
let currentTool = 'spawn';
let currentShape = 'circle';
let currentColor = '#ff4466';
let jellySize = 40;
let softness = 50;
let gravityStrength = 50;
const jellies = [];

// ---- UI wiring ----
document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentTool = btn.dataset.tool;
        canvas.style.cursor = currentTool === 'drag' ? 'grab' :
                              currentTool === 'poke' ? 'pointer' :
                              currentTool === 'delete' ? 'not-allowed' : 'crosshair';
    });
});

document.querySelectorAll('.shape-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.shape-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentShape = btn.dataset.shape;
    });
});

document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentColor = btn.dataset.color;
    });
});

const sizeSlider = document.getElementById('sizeSlider');
const sizeVal = document.getElementById('sizeVal');
sizeSlider.addEventListener('input', () => { jellySize = +sizeSlider.value; sizeVal.textContent = jellySize; });

const softnessSlider = document.getElementById('softnessSlider');
const softnessVal = document.getElementById('softnessVal');
softnessSlider.addEventListener('input', () => { softness = +softnessSlider.value; softnessVal.textContent = softness; });

const gravitySlider = document.getElementById('gravitySlider');
const gravityVal = document.getElementById('gravityVal');
gravitySlider.addEventListener('input', () => { gravityStrength = +gravitySlider.value; gravityVal.textContent = gravityStrength; });

document.getElementById('clearBtn').addEventListener('click', () => { jellies.length = 0; });
document.getElementById('shakeBtn').addEventListener('click', () => {
    jellies.forEach(j => {
        j.points.forEach(p => {
            p.vx += (Math.random() - 0.5) * 20;
            p.vy += (Math.random() - 0.5) * 20 - 8;
        });
    });
});

// ============================================================
//  SOFT-BODY JELLY CLASS
// ============================================================
class SoftBody {
    constructor(cx, cy, radius, shape, color, softness) {
        this.color = color;
        this.radius = radius;
        this.points = [];
        this.springs = [];
        this.pressureForce = 1.0;

        // Softness affects spring stiffness
        // Low softness = stiff, high softness = wobbly
        const stiffness = 0.15 - (softness / 100) * 0.12; // 0.15 (stiff) to 0.03 (soft)
        const damping = 0.92 + (softness / 100) * 0.06;    // 0.92 to 0.98
        this.damping = damping;
        this.stiffness = stiffness;

        // Generate points based on shape
        const pts = this._generateShape(cx, cy, radius, shape);
        
        for (const [px, py] of pts) {
            this.points.push({
                x: px, y: py,
                ox: px, oy: py, // original/rest positions relative to center
                vx: 0, vy: 0,
                rx: px - cx, ry: py - cy
            });
        }

        // Create springs: connect each point to every other (full mesh for pressure-like behavior)
        for (let i = 0; i < this.points.length; i++) {
            for (let j = i + 1; j < this.points.length; j++) {
                const dx = this.points[i].x - this.points[j].x;
                const dy = this.points[i].y - this.points[j].y;
                const restLen = Math.sqrt(dx * dx + dy * dy);
                this.springs.push({ i, j, restLen });
            }
        }

        // Calculate rest area for pressure
        this.restArea = this._calcArea();
        this.pressureAmount = 0.6 + (softness / 100) * 0.8;
    }

    _generateShape(cx, cy, r, shape) {
        const pts = [];
        let n;
        switch (shape) {
            case 'circle':
                n = Math.max(10, Math.round(r * 0.7));
                for (let i = 0; i < n; i++) {
                    const a = (i / n) * Math.PI * 2;
                    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
                }
                break;
            case 'square': {
                const segs = Math.max(3, Math.round(r * 0.2));
                const half = r * 0.85;
                // top
                for (let i = 0; i <= segs; i++) pts.push([cx - half + (2*half*i/segs), cy - half]);
                // right
                for (let i = 1; i <= segs; i++) pts.push([cx + half, cy - half + (2*half*i/segs)]);
                // bottom
                for (let i = 1; i <= segs; i++) pts.push([cx + half - (2*half*i/segs), cy + half]);
                // left
                for (let i = 1; i < segs; i++) pts.push([cx - half, cy + half - (2*half*i/segs)]);
                break;
            }
            case 'triangle': {
                const segs = Math.max(3, Math.round(r * 0.25));
                const verts = [];
                for (let i = 0; i < 3; i++) {
                    const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
                    verts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
                }
                for (let e = 0; e < 3; e++) {
                    const [x1, y1] = verts[e];
                    const [x2, y2] = verts[(e+1)%3];
                    for (let i = 0; i < segs; i++) {
                        const t = i / segs;
                        pts.push([x1 + (x2-x1)*t, y1 + (y2-y1)*t]);
                    }
                }
                break;
            }
            case 'blob':
                n = Math.max(12, Math.round(r * 0.8));
                for (let i = 0; i < n; i++) {
                    const a = (i / n) * Math.PI * 2;
                    const wobble = r * (0.7 + 0.3 * Math.sin(a * 3 + Math.random()));
                    pts.push([cx + Math.cos(a) * wobble, cy + Math.sin(a) * wobble]);
                }
                break;
        }
        return pts;
    }

    _calcArea() {
        let area = 0;
        const n = this.points.length;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            area += this.points[i].x * this.points[j].y;
            area -= this.points[j].x * this.points[i].y;
        }
        return Math.abs(area) / 2;
    }

    getCentroid() {
        let cx = 0, cy = 0;
        for (const p of this.points) { cx += p.x; cy += p.y; }
        return { x: cx / this.points.length, y: cy / this.points.length };
    }

    update(gravity, dt) {
        const n = this.points.length;

        // Apply gravity
        for (const p of this.points) {
            p.vy += gravity * dt;
        }

        // Spring forces
        for (const s of this.springs) {
            const a = this.points[s.i];
            const b = this.points[s.j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
            const diff = (dist - s.restLen) / dist;
            const fx = dx * diff * this.stiffness;
            const fy = dy * diff * this.stiffness;
            a.vx += fx;
            a.vy += fy;
            b.vx -= fx;
            b.vy -= fy;
        }

        // Pressure force — tries to maintain area
        const currentArea = this._calcArea();
        const pressureDiff = (this.restArea - currentArea) / (this.restArea || 1);
        
        for (let i = 0; i < n; i++) {
            const prev = this.points[(i - 1 + n) % n];
            const next = this.points[(i + 1) % n];
            // Edge normal
            const edx = next.x - prev.x;
            const edy = next.y - prev.y;
            const edgeLen = Math.sqrt(edx * edx + edy * edy) || 0.001;
            // Outward normal
            const nx = -edy / edgeLen;
            const ny = edx / edgeLen;

            const force = pressureDiff * this.pressureAmount * 2;
            this.points[i].vx += nx * force;
            this.points[i].vy += ny * force;
        }

        // Integrate
        for (const p of this.points) {
            p.vx *= this.damping;
            p.vy *= this.damping;
            p.x += p.vx;
            p.y += p.vy;
        }

        // Boundary collisions (in pixel coords, then scaled)
        for (const p of this.points) {
            // Floor
            if (p.y > bufH - 2) {
                p.y = bufH - 2;
                p.vy *= -0.5;
                p.vx *= 0.85; // friction
            }
            // Ceiling
            if (p.y < 2) {
                p.y = 2;
                p.vy *= -0.5;
            }
            // Walls
            if (p.x < 2) {
                p.x = 2;
                p.vx *= -0.5;
            }
            if (p.x > bufW - 2) {
                p.x = bufW - 2;
                p.vx *= -0.5;
            }
        }
    }

    containsPoint(px, py) {
        // Simple point-in-polygon (ray casting)
        const pts = this.points;
        const n = pts.length;
        let inside = false;
        for (let i = 0, j = n - 1; i < n; j = i++) {
            const xi = pts[i].x, yi = pts[i].y;
            const xj = pts[j].x, yj = pts[j].y;
            if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
        return inside;
    }

    distToCenter(px, py) {
        const c = this.getCentroid();
        const dx = c.x - px;
        const dy = c.y - py;
        return Math.sqrt(dx*dx + dy*dy);
    }

    draw(ctx) {
        const pts = this.points;
        if (pts.length < 3) return;

        // Parse color for shading
        const rgb = this._hexToRgb(this.color);
        const darkRgb = { r: Math.floor(rgb.r * 0.55), g: Math.floor(rgb.g * 0.55), b: Math.floor(rgb.b * 0.55) };
        const lightRgb = { r: Math.min(255, Math.floor(rgb.r * 1.3 + 40)), g: Math.min(255, Math.floor(rgb.g * 1.3 + 40)), b: Math.min(255, Math.floor(rgb.b * 1.3 + 40)) };

        // Fill body
        ctx.beginPath();
        ctx.moveTo(Math.round(pts[0].x), Math.round(pts[0].y));
        for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(Math.round(pts[i].x), Math.round(pts[i].y));
        }
        ctx.closePath();
        ctx.fillStyle = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
        ctx.fill();

        // Outline (darker)
        ctx.strokeStyle = `rgb(${darkRgb.r},${darkRgb.g},${darkRgb.b})`;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Highlight — small ellipse near top of centroid
        const c = this.getCentroid();
        const hlSize = this.radius / (PIXEL_SIZE * 3);
        ctx.beginPath();
        ctx.ellipse(
            Math.round(c.x - hlSize * 0.5),
            Math.round(c.y - hlSize * 1.2),
            Math.max(1, Math.round(hlSize)),
            Math.max(1, Math.round(hlSize * 0.6)),
            -0.3, 0, Math.PI * 2
        );
        ctx.fillStyle = `rgba(${lightRgb.r},${lightRgb.g},${lightRgb.b},0.6)`;
        ctx.fill();

        // Pixel "eye" dots for personality
        if (this.radius > 20) {
            const eyeOff = this.radius / (PIXEL_SIZE * 4);
            ctx.fillStyle = `rgb(${darkRgb.r},${darkRgb.g},${darkRgb.b})`;
            ctx.fillRect(Math.round(c.x - eyeOff - 1), Math.round(c.y - 1), 2, 2);
            ctx.fillRect(Math.round(c.x + eyeOff), Math.round(c.y - 1), 2, 2);
        }
    }

    _hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : { r: 255, g: 100, b: 100 };
    }
}

// ============================================================
//  JELLY-JELLY COLLISIONS
// ============================================================
function resolveJellyCollisions() {
    for (let a = 0; a < jellies.length; a++) {
        for (let b = a + 1; b < jellies.length; b++) {
            const ja = jellies[a];
            const jb = jellies[b];
            const ca = ja.getCentroid();
            const cb = jb.getCentroid();
            const dx = cb.x - ca.x;
            const dy = cb.y - ca.y;
            const dist = Math.sqrt(dx*dx + dy*dy) || 0.001;
            const minDist = (ja.radius + jb.radius) / (PIXEL_SIZE * 1.5);
            
            if (dist < minDist) {
                // Push apart at point level
                const overlap = (minDist - dist) / dist * 0.3;
                for (const p of ja.points) {
                    if (jb.containsPoint(p.x, p.y)) {
                        p.vx -= dx * overlap * 0.1;
                        p.vy -= dy * overlap * 0.1;
                    }
                }
                for (const p of jb.points) {
                    if (ja.containsPoint(p.x, p.y)) {
                        p.vx += dx * overlap * 0.1;
                        p.vy += dy * overlap * 0.1;
                    }
                }
            }
        }
    }
}

// ============================================================
//  MOUSE / TOUCH INTERACTION
// ============================================================
let mouseDown = false;
let mouseX = 0, mouseY = 0;
let draggedJelly = null;
let dragOffsets = [];

function getCanvasPos(e) {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
        x: (clientX - rect.left) / PIXEL_SIZE,
        y: (clientY - rect.top) / PIXEL_SIZE
    };
}

canvas.addEventListener('mousedown', onDown);
canvas.addEventListener('touchstart', e => { e.preventDefault(); onDown(e); }, { passive: false });
canvas.addEventListener('mousemove', onMove);
canvas.addEventListener('touchmove', e => { e.preventDefault(); onMove(e); }, { passive: false });
canvas.addEventListener('mouseup', onUp);
canvas.addEventListener('touchend', onUp);
canvas.addEventListener('mouseleave', onUp);

function onDown(e) {
    mouseDown = true;
    const pos = getCanvasPos(e);
    mouseX = pos.x;
    mouseY = pos.y;

    if (currentTool === 'spawn') {
        // Spawn a new jelly
        if (jellies.length < 50) {
            const j = new SoftBody(pos.x, pos.y, jellySize / PIXEL_SIZE, currentShape, currentColor, softness);
            jellies.push(j);
        }
    } else if (currentTool === 'drag') {
        // Find closest jelly to drag
        for (let i = jellies.length - 1; i >= 0; i--) {
            if (jellies[i].containsPoint(pos.x, pos.y) || jellies[i].distToCenter(pos.x, pos.y) < jellies[i].radius / PIXEL_SIZE) {
                draggedJelly = jellies[i];
                dragOffsets = draggedJelly.points.map(p => ({ dx: p.x - pos.x, dy: p.y - pos.y }));
                canvas.style.cursor = 'grabbing';
                break;
            }
        }
    } else if (currentTool === 'poke') {
        // Poke — apply radial force
        for (const j of jellies) {
            for (const p of j.points) {
                const dx = p.x - pos.x;
                const dy = p.y - pos.y;
                const dist = Math.sqrt(dx*dx + dy*dy) || 0.001;
                if (dist < 30) {
                    const force = (30 - dist) / 30 * 5;
                    p.vx += (dx / dist) * force;
                    p.vy += (dy / dist) * force;
                }
            }
        }
    } else if (currentTool === 'delete') {
        for (let i = jellies.length - 1; i >= 0; i--) {
            if (jellies[i].containsPoint(pos.x, pos.y) || jellies[i].distToCenter(pos.x, pos.y) < jellies[i].radius / PIXEL_SIZE) {
                // Spawn particles effect
                spawnDeleteParticles(jellies[i]);
                jellies.splice(i, 1);
                break;
            }
        }
    }
}

function onMove(e) {
    const pos = getCanvasPos(e);
    mouseX = pos.x;
    mouseY = pos.y;

    if (mouseDown && currentTool === 'drag' && draggedJelly) {
        // Move all points toward target
        for (let i = 0; i < draggedJelly.points.length; i++) {
            const target_x = pos.x + dragOffsets[i].dx;
            const target_y = pos.y + dragOffsets[i].dy;
            draggedJelly.points[i].vx += (target_x - draggedJelly.points[i].x) * 0.2;
            draggedJelly.points[i].vy += (target_y - draggedJelly.points[i].y) * 0.2;
        }
    }

    if (mouseDown && currentTool === 'poke') {
        for (const j of jellies) {
            for (const p of j.points) {
                const dx = p.x - pos.x;
                const dy = p.y - pos.y;
                const dist = Math.sqrt(dx*dx + dy*dy) || 0.001;
                if (dist < 25) {
                    const force = (25 - dist) / 25 * 3;
                    p.vx += (dx / dist) * force;
                    p.vy += (dy / dist) * force;
                }
            }
        }
    }
}

function onUp() {
    mouseDown = false;
    draggedJelly = null;
    if (currentTool === 'drag') canvas.style.cursor = 'grab';
}

// ============================================================
//  PARTICLE EFFECTS
// ============================================================
const particles = [];

function spawnDeleteParticles(jelly) {
    const c = jelly.getCentroid();
    const rgb = jelly._hexToRgb(jelly.color);
    for (let i = 0; i < 20; i++) {
        particles.push({
            x: c.x + (Math.random() - 0.5) * (jelly.radius / PIXEL_SIZE),
            y: c.y + (Math.random() - 0.5) * (jelly.radius / PIXEL_SIZE),
            vx: (Math.random() - 0.5) * 4,
            vy: (Math.random() - 0.5) * 4 - 2,
            life: 1,
            color: `rgb(${rgb.r},${rgb.g},${rgb.b})`,
            size: Math.random() * 2 + 1
        });
    }
}

function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.1;
        p.life -= 0.025;
        if (p.life <= 0) particles.splice(i, 1);
    }
}

function drawParticles(ctx) {
    for (const p of particles) {
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), Math.round(p.size), Math.round(p.size));
    }
    ctx.globalAlpha = 1;
}

// ============================================================
//  BACKGROUND GRID
// ============================================================
function drawBackground(ctx) {
    ctx.fillStyle = '#12121e';
    ctx.fillRect(0, 0, bufW, bufH);
    
    // Pixel grid dots
    ctx.fillStyle = '#1a1a30';
    for (let x = 0; x < bufW; x += 8) {
        for (let y = 0; y < bufH; y += 8) {
            ctx.fillRect(x, y, 1, 1);
        }
    }

    // Floor line
    ctx.fillStyle = '#2a2a50';
    ctx.fillRect(0, bufH - 2, bufW, 1);
    ctx.fillStyle = '#1e1e3a';
    ctx.fillRect(0, bufH - 1, bufW, 1);
}

// ============================================================
//  MAIN LOOP
// ============================================================
let lastTime = performance.now();

function frame(time) {
    requestAnimationFrame(frame);

    const dt = Math.min((time - lastTime) / 16.667, 3); // cap delta
    lastTime = time;

    const gravity = (gravityStrength / 50) * 0.25;

    // Physics substeps for stability
    const substeps = 2;
    for (let s = 0; s < substeps; s++) {
        for (const j of jellies) {
            j.update(gravity, dt / substeps);
        }
        resolveJellyCollisions();
    }

    updateParticles();

    // ---- RENDER TO LOW-RES BUFFER ----
    offCtx.imageSmoothingEnabled = false;
    drawBackground(offCtx);

    // Jelly shadows
    for (const j of jellies) {
        const c = j.getCentroid();
        offCtx.fillStyle = 'rgba(0,0,0,0.15)';
        offCtx.beginPath();
        const pts = j.points;
        offCtx.moveTo(Math.round(pts[0].x + 2), Math.round(pts[0].y + 2));
        for (let i = 1; i < pts.length; i++) {
            offCtx.lineTo(Math.round(pts[i].x + 2), Math.round(pts[i].y + 2));
        }
        offCtx.closePath();
        offCtx.fill();
    }

    // Draw jellies
    for (const j of jellies) {
        j.draw(offCtx);
    }

    drawParticles(offCtx);

    // Draw cursor indicator
    if (currentTool === 'poke') {
        offCtx.strokeStyle = 'rgba(255,255,255,0.3)';
        offCtx.lineWidth = 1;
        offCtx.beginPath();
        offCtx.arc(Math.round(mouseX), Math.round(mouseY), 25, 0, Math.PI * 2);
        offCtx.stroke();
    }

    // ---- UPSCALE TO MAIN CANVAS (PIXELATED) ----
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(offCanvas, 0, 0, bufW, bufH, 0, 0, W, H);
}

requestAnimationFrame(frame);
