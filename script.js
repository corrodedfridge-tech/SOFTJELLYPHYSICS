// =====================================================
//  PIXEL JELLY SANDBOX — Pressure-Based Soft Body
// =====================================================

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// Pixel scale for chunky retro look
const PX = 3;
let W, H, bW, bH;

const off = document.createElement('canvas');
const oCtx = off.getContext('2d');

function resize() {
    const r = canvas.getBoundingClientRect();
    W = r.width; H = r.height;
    canvas.width = W; canvas.height = H;
    bW = Math.ceil(W / PX);
    bH = Math.ceil(H / PX);
    off.width = bW; off.height = bH;
}
window.addEventListener('resize', resize);
resize();

// ---- Settings ----
let tool = 'spawn', shape = 'circle', color = '#ff4466';
let sizeSetting = 30, softSetting = 60, pressureSetting = 50, gravitySetting = 50;

const bodies = [];
const particles = [];

// ---- UI ----
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

$$('.tool-btn').forEach(b => b.onclick = () => {
    $$('.tool-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    tool = b.dataset.tool;
    canvas.style.cursor = tool === 'drag' ? 'grab' : tool === 'poke' ? 'pointer' : tool === 'delete' ? 'not-allowed' : 'crosshair';
});

$$('.shape-btn').forEach(b => b.onclick = () => {
    $$('.shape-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    shape = b.dataset.shape;
});

$$('.color-btn').forEach(b => b.onclick = () => {
    $$('.color-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    color = b.dataset.color;
});

$('#sizeSlider').oninput = e => { sizeSetting = +e.target.value; $('#sizeVal').textContent = sizeSetting; };
$('#softnessSlider').oninput = e => { softSetting = +e.target.value; $('#softnessVal').textContent = softSetting; };
$('#pressureSlider').oninput = e => { pressureSetting = +e.target.value; $('#pressureVal').textContent = pressureSetting; };
$('#gravitySlider').oninput = e => { gravitySetting = +e.target.value; $('#gravityVal').textContent = gravitySetting; };

$('#clearBtn').onclick = () => bodies.length = 0;
$('#shakeBtn').onclick = () => {
    for (const b of bodies)
        for (const p of b.pts) {
            p.vx += (Math.random() - 0.5) * 15;
            p.vy -= Math.random() * 12;
        }
};

// =====================================================
//  SOFT BODY — Pressure Model
//
//  Each body is a ring of point-masses connected by
//  springs. An internal GAS PRESSURE force pushes
//  outward on every edge, proportional to
//  (restVolume − currentVolume) / edgeLength.
//  This makes the body try to maintain its area
//  (volume in 2D) while being squishy — exactly
//  how real jelly / slime behaves.
// =====================================================

class SoftBody {
    constructor(cx, cy, r, shape, color, soft, pressure) {
        this.color = color;
        const n = this.numPoints(r, shape);
        this.pts = [];
        this.springs = [];

        // Spring stiffness: lower softness → stiffer
        this.kSpring = 0.4 - (soft / 100) * 0.35;       // 0.4 → 0.05
        this.kDamp = 0.015 + (soft / 100) * 0.025;       // damping on springs
        this.drag = 0.993 - (soft / 100) * 0.008;        // velocity drag
        this.kPressure = 0.1 + (pressure / 100) * 1.4;   // gas pressure

        // Build the ring of points
        const ring = this.buildRing(cx, cy, r / PX, shape, n);
        for (const [px, py] of ring) {
            this.pts.push({ x: px, y: py, vx: 0, vy: 0 });
        }

        // Perimeter springs (adjacent)
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            this.springs.push(this.makeSpring(i, j));
        }

        // Cross-brace springs for structural rigidity (skip-1 neighbors)
        for (let i = 0; i < n; i++) {
            const j = (i + 2) % n;
            this.springs.push(this.makeSpring(i, j, 0.6));
        }

        // A few diameter springs for large bodies
        if (n >= 12) {
            for (let i = 0; i < Math.floor(n / 2); i += 2) {
                const j = (i + Math.floor(n / 2)) % n;
                this.springs.push(this.makeSpring(i, j, 0.15));
            }
        }

        this.restArea = this.area();
        this.r = r / PX;
    }

    numPoints(r, shape) {
        const base = Math.round(r / PX);
        if (shape === 'triangle') return Math.max(9, base * 3);
        if (shape === 'square') return Math.max(12, base * 4);
        return Math.max(10, Math.round(base * 2.5));
    }

    buildRing(cx, cy, r, shape, n) {
        const pts = [];
        if (shape === 'square') {
            const half = r * 0.9;
            const sides = [
                [[-half, -half], [half, -half]],
                [[half, -half], [half, half]],
                [[half, half], [-half, half]],
                [[-half, half], [-half, -half]],
            ];
            const perSide = Math.ceil(n / 4);
            for (const [[x1, y1], [x2, y2]] of sides) {
                for (let i = 0; i < perSide; i++) {
                    const t = i / perSide;
                    pts.push([cx + x1 + (x2 - x1) * t, cy + y1 + (y2 - y1) * t]);
                }
            }
            while (pts.length > n) pts.pop();
        } else if (shape === 'triangle') {
            const verts = [];
            for (let i = 0; i < 3; i++) {
                const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
                verts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
            }
            const perSide = Math.ceil(n / 3);
            for (let s = 0; s < 3; s++) {
                const [x1, y1] = verts[s];
                const [x2, y2] = verts[(s + 1) % 3];
                for (let i = 0; i < perSide; i++) {
                    const t = i / perSide;
                    pts.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
                }
            }
            while (pts.length > n) pts.pop();
        } else {
            for (let i = 0; i < n; i++) {
                const a = (i / n) * Math.PI * 2;
                pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
            }
        }
        return pts;
    }

    makeSpring(i, j, stiffMul = 1.0) {
        const dx = this.pts[i].x - this.pts[j].x;
        const dy = this.pts[i].y - this.pts[j].y;
        return { i, j, rest: Math.sqrt(dx * dx + dy * dy), stiffMul };
    }

    area() {
        let a = 0;
        const n = this.pts.length;
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            a += this.pts[i].x * this.pts[j].y;
            a -= this.pts[j].x * this.pts[i].y;
        }
        return Math.abs(a) * 0.5;
    }

    centroid() {
        let cx = 0, cy = 0;
        for (const p of this.pts) { cx += p.x; cy += p.y; }
        return { x: cx / this.pts.length, y: cy / this.pts.length };
    }

    // --- Physics step ---
    step(gravity, dt) {
        const n = this.pts.length;

        // 1) Gravity
        for (const p of this.pts) {
            p.vy += gravity * dt;
        }

        // 2) Spring forces
        for (const s of this.springs) {
            const a = this.pts[s.i];
            const b = this.pts[s.j];
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 0.0001;
            dx /= dist; dy /= dist;

            const stretch = dist - s.rest;
            const k = this.kSpring * s.stiffMul;

            // Spring + damping
            const relVx = b.vx - a.vx;
            const relVy = b.vy - a.vy;
            const dampF = (relVx * dx + relVy * dy) * this.kDamp;

            const force = stretch * k + dampF;
            a.vx += dx * force;
            a.vy += dy * force;
            b.vx -= dx * force;
            b.vy -= dy * force;
        }

        // 3) PRESSURE — the key to soft-body "slime" feel
        //    For each edge, compute outward normal, push both
        //    endpoints outward proportional to pressure deficit.
        const curArea = this.area();
        const deficit = (this.restArea - curArea) / (this.restArea || 1);
        // Gas law style: pressure inversely proportional to volume
        const P = this.kPressure * (this.restArea / (curArea || 0.01));

        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const pi = this.pts[i];
            const pj = this.pts[j];

            const ex = pj.x - pi.x;
            const ey = pj.y - pi.y;
            const edgeLen = Math.sqrt(ex * ex + ey * ey) || 0.001;

            // Outward normal (perpendicular, pointing outward for CCW winding)
            const nx = -ey / edgeLen;
            const ny = ex / edgeLen;

            // Force magnitude proportional to pressure and edge length
            const f = P * edgeLen * 0.5 * dt;

            pi.vx += nx * f;
            pi.vy += ny * f;
            pj.vx += nx * f;
            pj.vy += ny * f;
        }

        // 4) Integrate + drag
        for (const p of this.pts) {
            p.vx *= this.drag;
            p.vy *= this.drag;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
        }

        // 5) Boundary — ground squish, walls, ceiling
        const floorY = bH - 1;
        const friction = 0.7;
        const bounce = 0.3;

        for (const p of this.pts) {
            if (p.y > floorY) {
                p.y = floorY;
                if (p.vy > 0) p.vy *= -bounce;
                p.vx *= friction;
            }
            if (p.y < 1) { p.y = 1; if (p.vy < 0) p.vy *= -bounce; }
            if (p.x < 1) { p.x = 1; if (p.vx < 0) p.vx *= -bounce; p.vy *= friction; }
            if (p.x > bW - 1) { p.x = bW - 1; if (p.vx > 0) p.vx *= -bounce; p.vy *= friction; }
        }
    }

    // Point-in-polygon test
    contains(px, py) {
        let inside = false;
        const pts = this.pts;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            if (((pts[i].y > py) !== (pts[j].y > py)) &&
                (px < (pts[j].x - pts[i].x) * (py - pts[i].y) / (pts[j].y - pts[i].y) + pts[i].x)) {
                inside = !inside;
            }
        }
        return inside;
    }

    distTo(px, py) {
        const c = this.centroid();
        return Math.hypot(c.x - px, c.y - py);
    }

    // Push individual surface points out from a world point
    poke(px, py, radius, strength) {
        for (const p of this.pts) {
            const dx = p.x - px;
            const dy = p.y - py;
            const d = Math.hypot(dx, dy) || 0.01;
            if (d < radius) {
                const f = ((radius - d) / radius) * strength;
                p.vx += (dx / d) * f;
                p.vy += (dy / d) * f;
            }
        }
    }

    // --- Rendering ---
    draw(ctx) {
        const pts = this.pts;
        if (pts.length < 3) return;

        const rgb = hexRgb(this.color);
        const dark = { r: rgb.r * 0.45 | 0, g: rgb.g * 0.45 | 0, b: rgb.b * 0.45 | 0 };
        const mid = { r: rgb.r * 0.75 | 0, g: rgb.g * 0.75 | 0, b: rgb.b * 0.75 | 0 };
        const light = {
            r: Math.min(255, rgb.r * 1.15 + 60) | 0,
            g: Math.min(255, rgb.g * 1.15 + 60) | 0,
            b: Math.min(255, rgb.b * 1.15 + 60) | 0
        };

        const c = this.centroid();

        // Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.beginPath();
        ctx.moveTo(pts[0].x + 1.5 | 0, pts[0].y + 2 | 0);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x + 1.5 | 0, pts[i].y + 2 | 0);
        ctx.closePath();
        ctx.fill();

        // Body fill — base color
        ctx.fillStyle = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
        ctx.beginPath();
        ctx.moveTo(pts[0].x | 0, pts[0].y | 0);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x | 0, pts[i].y | 0);
        ctx.closePath();
        ctx.fill();

        // Darker bottom half overlay for depth
        ctx.save();
        ctx.clip(); // clip to body shape
        ctx.fillStyle = `rgba(0,0,0,0.15)`;
        ctx.fillRect(0, c.y | 0, bW, bH);
        ctx.restore();

        // Outline
        ctx.strokeStyle = `rgb(${dark.r},${dark.g},${dark.b})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pts[0].x | 0, pts[0].y | 0);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x | 0, pts[i].y | 0);
        ctx.closePath();
        ctx.stroke();

        // Specular highlight blob
        const hlR = Math.max(2, this.r * 0.35);
        ctx.fillStyle = `rgba(${light.r},${light.g},${light.b},0.55)`;
        ctx.beginPath();
        ctx.ellipse(c.x - hlR * 0.3 | 0, c.y - hlR * 1.0 | 0, hlR, hlR * 0.55, -0.2, 0, Math.PI * 2);
        ctx.fill();

        // Small hard specular dot
        ctx.fillStyle = `rgba(255,255,255,0.45)`;
        const dotR = Math.max(1, this.r * 0.12);
        ctx.fillRect(c.x - hlR * 0.4 | 0, c.y - hlR * 1.1 | 0, dotR, dotR);

        // Eyes
        if (this.r > 6) {
            const ey = c.y - this.r * 0.05;
            const ex = this.r * 0.22;
            const es = Math.max(1, this.r * 0.1) | 0;

            // White
            ctx.fillStyle = `rgba(255,255,255,0.8)`;
            ctx.fillRect(c.x - ex - es * 0.5 | 0, ey - es * 0.5 | 0, es + 1, es + 1);
            ctx.fillRect(c.x + ex - es * 0.5 | 0, ey - es * 0.5 | 0, es + 1, es + 1);

            // Pupils
            ctx.fillStyle = `rgb(${dark.r},${dark.g},${dark.b})`;
            ctx.fillRect(c.x - ex | 0, ey | 0, es, es);
            ctx.fillRect(c.x + ex | 0, ey | 0, es, es);
        }
    }
}

// =====================================================
//  BODY-BODY COLLISION
// =====================================================
function bodyCollisions() {
    for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
            const A = bodies[i], B = bodies[j];
            const ca = A.centroid(), cb = B.centroid();
            const dist = Math.hypot(ca.x - cb.x, ca.y - cb.y);

            // Broad phase — skip if too far
            if (dist > A.r + B.r + 4) continue;

            // Check A's points inside B
            for (const p of A.pts) {
                if (B.contains(p.x, p.y)) {
                    pushOut(p, B);
                }
            }
            // Check B's points inside A
            for (const p of B.pts) {
                if (A.contains(p.x, p.y)) {
                    pushOut(p, A);
                }
            }
        }
    }
}

function pushOut(point, body) {
    // Find closest edge on body and push point out along its normal
    const pts = body.pts;
    const n = pts.length;
    let bestDist = Infinity, bestNx = 0, bestNy = 0;

    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ex = pts[j].x - pts[i].x;
        const ey = pts[j].y - pts[i].y;
        const len = Math.hypot(ex, ey) || 0.001;
        // Normal pointing outward (for CCW winding)
        const nx = -ey / len;
        const ny = ex / len;

        // Project point onto edge
        const t = Math.max(0, Math.min(1,
            ((point.x - pts[i].x) * ex + (point.y - pts[i].y) * ey) / (len * len)));
        const closestX = pts[i].x + ex * t;
        const closestY = pts[i].y + ey * t;
        const d = Math.hypot(point.x - closestX, point.y - closestY);

        if (d < bestDist) {
            bestDist = d;
            bestNx = nx;
            bestNy = ny;
        }
    }

    const pushForce = 0.8;
    point.vx += bestNx * pushForce;
    point.vy += bestNy * pushForce;

    // Also push the body's points inward slightly (Newton's 3rd law feel)
    const c = body.centroid();
    for (const p of body.pts) {
        const dx = p.x - point.x;
        const dy = p.y - point.y;
        const d = Math.hypot(dx, dy) || 0.01;
        if (d < body.r * 0.8) {
            p.vx -= bestNx * pushForce * 0.15;
            p.vy -= bestNy * pushForce * 0.15;
        }
    }
}

// =====================================================
//  MOUSE / TOUCH
// =====================================================
let mDown = false, mX = 0, mY = 0;
let dragged = null, dragOffs = [];

function pos(e) {
    const r = canvas.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: (cx - r.left) / PX, y: (cy - r.top) / PX };
}

canvas.addEventListener('mousedown', down);
canvas.addEventListener('touchstart', e => { e.preventDefault(); down(e); }, { passive: false });
canvas.addEventListener('mousemove', move);
canvas.addEventListener('touchmove', e => { e.preventDefault(); move(e); }, { passive: false });
canvas.addEventListener('mouseup', up);
canvas.addEventListener('touchend', up);
canvas.addEventListener('mouseleave', up);

function down(e) {
    mDown = true;
    const p = pos(e);
    mX = p.x; mY = p.y;

    if (tool === 'spawn' && bodies.length < 40) {
        bodies.push(new SoftBody(p.x, p.y, sizeSetting, shape, color, softSetting, pressureSetting));
    } else if (tool === 'drag') {
        for (let i = bodies.length - 1; i >= 0; i--) {
            if (bodies[i].contains(p.x, p.y) || bodies[i].distTo(p.x, p.y) < bodies[i].r * 0.9) {
                dragged = bodies[i];
                dragOffs = dragged.pts.map(pt => ({ dx: pt.x - p.x, dy: pt.y - p.y }));
                canvas.style.cursor = 'grabbing';
                break;
            }
        }
    } else if (tool === 'poke') {
        for (const b of bodies) b.poke(p.x, p.y, 20, 4);
    } else if (tool === 'delete') {
        for (let i = bodies.length - 1; i >= 0; i--) {
            if (bodies[i].contains(p.x, p.y) || bodies[i].distTo(p.x, p.y) < bodies[i].r) {
                burstParticles(bodies[i]);
                bodies.splice(i, 1);
                break;
            }
        }
    }
}

function move(e) {
    const p = pos(e);
    mX = p.x; mY = p.y;

    if (!mDown) return;

    if (tool === 'drag' && dragged) {
        for (let i = 0; i < dragged.pts.length; i++) {
            const tx = p.x + dragOffs[i].dx;
            const ty = p.y + dragOffs[i].dy;
            dragged.pts[i].vx += (tx - dragged.pts[i].x) * 0.25;
            dragged.pts[i].vy += (ty - dragged.pts[i].y) * 0.25;
        }
    }

    if (tool === 'poke') {
        for (const b of bodies) b.poke(p.x, p.y, 15, 2.5);
    }
}

function up() {
    mDown = false;
    dragged = null;
    if (tool === 'drag') canvas.style.cursor = 'grab';
}

// =====================================================
//  PARTICLES
// =====================================================
function burstParticles(body) {
    const c = body.centroid();
    const rgb = hexRgb(body.color);
    for (let i = 0; i < 25; i++) {
        particles.push({
            x: c.x + (Math.random() - 0.5) * body.r * 1.5,
            y: c.y + (Math.random() - 0.5) * body.r * 1.5,
            vx: (Math.random() - 0.5) * 5,
            vy: (Math.random() - 0.5) * 5 - 3,
            life: 1,
            r: rgb.r, g: rgb.g, b: rgb.b,
            sz: (Math.random() * 2 + 1) | 0
        });
    }
}

function tickParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.vy += 0.12;
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.03;
        if (p.life <= 0) particles.splice(i, 1);
    }
}

function drawParticles(ctx) {
    for (const p of particles) {
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = `rgb(${p.r},${p.g},${p.b})`;
        ctx.fillRect(p.x | 0, p.y | 0, p.sz, p.sz);
    }
    ctx.globalAlpha = 1;
}

// =====================================================
//  HELPERS
// =====================================================
function hexRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 255, g: 100, b: 100 };
}

// =====================================================
//  BACKGROUND
// =====================================================
function drawBg(ctx) {
    ctx.fillStyle = '#0d0d18';
    ctx.fillRect(0, 0, bW, bH);

    // Subtle dot grid
    ctx.fillStyle = '#16162a';
    for (let x = 0; x < bW; x += 6)
        for (let y = 0; y < bH; y += 6)
            ctx.fillRect(x, y, 1, 1);

    // Floor
    ctx.fillStyle = '#222244';
    ctx.fillRect(0, bH - 1, bW, 1);
    ctx.fillStyle = '#191930';
    ctx.fillRect(0, bH - 2, bW, 1);
}

// =====================================================
//  MAIN LOOP
// =====================================================
let lastT = performance.now();

function loop(t) {
    requestAnimationFrame(loop);
    const raw = (t - lastT) / 16.667;
    const dt = Math.min(raw, 3);
    lastT = t;

    const grav = (gravitySetting / 50) * 0.3;

    // Physics sub-steps for stability
    const steps = 3;
    for (let s = 0; s < steps; s++) {
        for (const b of bodies) b.step(grav, dt / steps);
        bodyCollisions();
    }

    tickParticles();

    // Render to low-res buffer
    oCtx.imageSmoothingEnabled = false;
    drawBg(oCtx);

    for (const b of bodies) b.draw(oCtx);
    drawParticles(oCtx);

    // Cursor glow for poke
    if (tool === 'poke') {
        oCtx.strokeStyle = 'rgba(255,255,255,0.2)';
        oCtx.lineWidth = 1;
        oCtx.beginPath();
        oCtx.arc(mX | 0, mY | 0, 15, 0, Math.PI * 2);
        oCtx.stroke();
    }

    // Upscale pixelated
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, bW, bH, 0, 0, W, H);
}

requestAnimationFrame(loop);
