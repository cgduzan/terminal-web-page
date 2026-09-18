/**
 * fsn.js — Jurassic Park–style 3D File System Navigator.
 *
 * Fullscreen canvas fly-through of the live fake filesystem (seed + overlay).
 * Zero dependencies: Canvas 2D + perspective projection.
 *
 * TERM.fsn.open(term, startSegs) — called from terminal.js / the `fsn` command.
 */

TERM.fsn = {
  open(term, startSegs) {
    if (term._fsnOpen) return;
    if (document.querySelector(".fsn-overlay")) return;
    term._fsnOpen = true;

    const root = document.createElement("div");
    root.className = "fsn-overlay";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "3D file system navigator");

    const canvas = document.createElement("canvas");
    canvas.className = "fsn-canvas";
    root.appendChild(canvas);

    const hud = document.createElement("div");
    hud.className = "fsn-hud";
    hud.innerHTML =
      `<div class="fsn-title">fsn — File System Navigator</div>` +
      `<div class="fsn-quote">It's a Unix system! I know this!</div>` +
      `<div class="fsn-path"></div>` +
      `<div class="fsn-hint">WASD move · drag look · ←/→ or tap select · Enter open · Backspace up · Esc quit</div>`;
    root.appendChild(hud);
    const pathEl = hud.querySelector(".fsn-path");

    document.body.appendChild(root);

    const ctx = canvas.getContext("2d");
    let W = 0;
    let H = 0;
    const resize = () => {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
    };
    resize();

    // --- FS tree ------------------------------------------------------------

    const MAX_DEPTH = 4;
    let viewSegs = startSegs.slice();
    let boxes = [];
    let selected = 0;

    const pathStr = (segs) => (segs.length ? "/" + segs.join("/") : "/");

    const sortNames = (a, b) => {
      if (a === b) return 0;
      if (a.startsWith(".") !== b.startsWith(".")) return a.startsWith(".") ? 1 : -1;
      return a.localeCompare(b);
    };

    function buildTree(segs, depth) {
      const node = term.getNode(segs);
      if (!node) return null;
      const name = segs.length ? segs[segs.length - 1] : "/";
      if (node.type !== "dir") {
        return {
          name,
          type: node.type,
          locked: !!node.locked,
          segs: segs.slice(),
          children: [],
        };
      }
      const children = [];
      if (depth < MAX_DEPTH) {
        const listing = term.listDir(segs) || {};
        for (const name of Object.keys(listing).sort(sortNames)) {
          const child = buildTree(segs.concat(name), depth + 1);
          if (child) children.push(child);
        }
      }
      return {
        name,
        type: "dir",
        locked: false,
        segs: segs.slice(),
        children,
      };
    }

    // Place platforms (dirs) and file cubes in world space.
    // y-up: platforms sit on y=0 locally; nested dirs step down in -z rows.
    function layout(tree) {
      const out = [];
      if (!tree) return out;

      const FILE_GAP = 1.5;
      const DIR_GAP = 3.6;
      const PLATFORM_H = 0.35;
      const PAD = 1.6;

      function gridFor(fileCount) {
        const n = Math.max(fileCount, 1);
        const cols = fileCount <= 8 ? Math.max(1, fileCount) : Math.ceil(Math.sqrt(n));
        const rows = Math.ceil(n / cols);
        const pw = Math.max(5, cols * FILE_GAP + PAD * 2);
        const pd = Math.max(4.5, rows * FILE_GAP + PAD * 2);
        return { cols, rows, pw, pd };
      }

      function placeDir(node, ox, oy, oz) {
        const files = node.children.filter((c) => c.type !== "dir");
        const dirs = node.children.filter((c) => c.type === "dir");
        const { cols, pw, pd } = gridFor(files.length);

        out.push({
          kind: "platform",
          name: node.name,
          type: "dir",
          segs: node.segs,
          x: ox,
          y: oy,
          z: oz,
          w: pw,
          h: PLATFORM_H,
          d: pd,
        });

        files.forEach((f, i) => {
          const c = i % cols;
          const r = Math.floor(i / cols);
          const fx = ox - pw / 2 + PAD + FILE_GAP / 2 + c * FILE_GAP;
          const fz = oz - pd / 2 + PAD + FILE_GAP / 2 + r * FILE_GAP;
          const fh = f.locked ? 1.4 : f.type === "link" ? 1.1 : 0.85;
          out.push({
            kind: "file",
            name: f.name,
            type: f.type,
            locked: f.locked,
            segs: f.segs,
            x: fx,
            y: oy + PLATFORM_H / 2 + fh / 2,
            z: fz,
            w: 0.7,
            h: fh,
            d: 0.7,
          });
        });

        if (!dirs.length) return { w: pw, d: pd };

        const childLayouts = dirs.map((d) => ({ node: d, size: measureDir(d) }));
        const totalW =
          childLayouts.reduce((s, c) => s + c.size.w, 0) +
          DIR_GAP * (dirs.length - 1);
        let cx = ox - totalW / 2;
        const childZ = oz - pd / 2 - DIR_GAP - 1;

        childLayouts.forEach((cl) => {
          const childOx = cx + cl.size.w / 2;
          const childOy = oy - 0.15;
          const childOz = childZ - cl.size.d / 2;
          placeDir(cl.node, childOx, childOy, childOz);
          out.push({
            kind: "link",
            x1: ox,
            y1: oy,
            z1: oz - pd / 2,
            x2: childOx,
            y2: childOy,
            z2: childOz + cl.size.d / 2,
          });
          cx += cl.size.w + DIR_GAP;
        });

        return {
          w: Math.max(pw, totalW),
          d: pd + DIR_GAP + Math.max(...childLayouts.map((c) => c.size.d)),
        };
      }

      function measureDir(node) {
        const files = node.children.filter((c) => c.type !== "dir");
        const dirs = node.children.filter((c) => c.type === "dir");
        const { pw, pd } = gridFor(files.length);
        if (!dirs.length) return { w: pw, d: pd };
        const childSizes = dirs.map(measureDir);
        const totalW =
          childSizes.reduce((s, c) => s + c.w, 0) + DIR_GAP * (dirs.length - 1);
        const maxChildD = Math.max(...childSizes.map((c) => c.d));
        return {
          w: Math.max(pw, totalW),
          d: pd + DIR_GAP + maxChildD,
        };
      }

      placeDir(tree, 0, 0, 0);
      return out;
    }

    function sameSegs(a, b) {
      return a.length === b.length && a.every((s, i) => s === b[i]);
    }

    function overlookFor(plat) {
      return {
        x: plat.x,
        y: plat.y + 9,
        z: plat.z + plat.d / 2 + 14,
        yaw: Math.PI,
        pitch: -0.55,
      };
    }

    function rootPlatform() {
      return boxes.find(
        (b) =>
          b.kind === "platform" &&
          sameSegs(b.segs, viewSegs)
      );
    }

    function rebuild(opts = {}) {
      const { snapCam = true } = opts;
      const tree = buildTree(viewSegs, 0);
      boxes = layout(tree);
      selected = 0; // index into selectable() — direct children only
      pathEl.textContent = pathStr(viewSegs);
      if (snapCam) {
        const rootPlat = rootPlatform();
        if (rootPlat) Object.assign(cam, overlookFor(rootPlat));
      }
    }

    // --- camera -------------------------------------------------------------

    const cam = { x: 0, y: 6, z: 12, yaw: Math.PI, pitch: -0.4 };
    const keys = Object.create(null);
    let pointerDragging = false;
    let ptrMoved = false;
    let lastPtr = null;
    let raf = 0;
    let lastT = performance.now();

    const reduceMotion =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const FLY_MS = reduceMotion ? 0 : 0.75;
    const REFRAME_MS = reduceMotion ? 0 : 0.35;
    // kind: "fly" (enter/up — blocks keys) | "reframe" (selection — interruptible)
    let camAnim = null; // { from, to, t, dur, onDone, kind }

    function copyCam() {
      return {
        x: cam.x,
        y: cam.y,
        z: cam.z,
        yaw: cam.yaw,
        pitch: cam.pitch,
      };
    }

    function lerpAngle(a, b, t) {
      let d = b - a;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return a + d * t;
    }

    function applyCamLerp(from, to, t) {
      const e = t * t * (3 - 2 * t); // smoothstep
      cam.x = from.x + (to.x - from.x) * e;
      cam.y = from.y + (to.y - from.y) * e;
      cam.z = from.z + (to.z - from.z) * e;
      cam.yaw = lerpAngle(from.yaw, to.yaw, e);
      cam.pitch = from.pitch + (to.pitch - from.pitch) * e;
    }

    function animateCamTo(to, onDone, opts = {}) {
      const kind = opts.kind || "fly";
      const dur = opts.dur != null ? opts.dur : FLY_MS;
      if (dur <= 0) {
        Object.assign(cam, to);
        camAnim = null;
        if (onDone) onDone();
        return;
      }
      camAnim = {
        from: copyCam(),
        to,
        t: 0,
        dur,
        kind,
        onDone: onDone || null,
      };
    }

    function updateCamAnim(dt) {
      if (!camAnim) return;
      camAnim.t += dt;
      const u = Math.min(1, camAnim.t / camAnim.dur);
      applyCamLerp(camAnim.from, camAnim.to, u);
      if (u >= 1) {
        Object.assign(cam, camAnim.to);
        const cb = camAnim.onDone;
        camAnim = null;
        if (cb) cb();
      }
    }

    rebuild();

    // --- projection / draw --------------------------------------------------

    function rotYawPitch(dx, dy, dz) {
      // yaw around Y, then pitch around X
      const cy = Math.cos(cam.yaw);
      const sy = Math.sin(cam.yaw);
      let x = dx * cy - dz * sy;
      let z = dx * sy + dz * cy;
      const cp = Math.cos(cam.pitch);
      const sp = Math.sin(cam.pitch);
      const y = dy * cp - z * sp;
      z = dy * sp + z * cp;
      return { x, y, z };
    }

    function project(wx, wy, wz) {
      const r = rotYawPitch(wx - cam.x, wy - cam.y, wz - cam.z);
      if (r.z <= 0.15) return null;
      const fov = Math.min(W, H) * 0.9;
      return {
        x: W / 2 + (r.x / r.z) * fov,
        y: H / 2 - (r.y / r.z) * fov,
        z: r.z,
        s: fov / r.z,
      };
    }

    function boxCorners(b) {
      const hw = b.w / 2;
      const hh = b.h / 2;
      const hd = b.d / 2;
      const pts = [];
      for (const sx of [-1, 1])
        for (const sy of [-1, 1])
          for (const sz of [-1, 1])
            pts.push({ x: b.x + sx * hw, y: b.y + sy * hh, z: b.z + sz * hd });
      return pts;
    }

    // Faces as corner index sets (for painter sort by avg depth)
    const FACES = [
      [0, 1, 3, 2], // -x
      [4, 5, 7, 6], // +x
      [0, 1, 5, 4], // -y
      [2, 3, 7, 6], // +y
      [0, 2, 6, 4], // -z
      [1, 3, 7, 5], // +z
    ];

    function colorFor(b, selectedBox) {
      const sel = b === selectedBox;
      if (b.kind === "platform") {
        return {
          fill: sel ? "rgba(220, 80, 255, 0.55)" : "rgba(160, 40, 220, 0.38)",
          stroke: sel ? "#ffa0ff" : "#c44dff",
        };
      }
      if (b.locked) {
        return {
          fill: sel ? "rgba(255, 70, 70, 0.7)" : "rgba(200, 40, 40, 0.5)",
          stroke: "#ff6666",
        };
      }
      if (b.type === "link") {
        return {
          fill: sel ? "rgba(255, 220, 80, 0.7)" : "rgba(220, 180, 40, 0.5)",
          stroke: "#ffd84d",
        };
      }
      return {
        fill: sel ? "rgba(80, 255, 220, 0.7)" : "rgba(40, 200, 180, 0.5)",
        stroke: "#5affe0",
      };
    }

    function drawBox(b, selectedBox) {
      const corners = boxCorners(b).map((p) => {
        const scr = project(p.x, p.y, p.z);
        // if a corner is behind the near plane, nudge it just in front so the
        // face can still draw (avoids whole boxes vanishing at the near clip)
        if (!scr) {
          const r = rotYawPitch(p.x - cam.x, p.y - cam.y, p.z - cam.z);
          const z = 0.2;
          const fov = Math.min(W, H) * 0.9;
          return {
            world: p,
            scr: {
              x: W / 2 + (r.x / z) * fov,
              y: H / 2 - (r.y / z) * fov,
              z,
              s: fov / z,
            },
            behind: true,
          };
        }
        return { world: p, scr, behind: false };
      });
      if (corners.every((c) => c.behind)) return;
      const cols = colorFor(b, selectedBox);

      const faces = FACES.map((idx) => {
        const pts = idx.map((i) => corners[i]);
        const avgZ = pts.reduce((s, p) => s + p.scr.z, 0) / pts.length;
        return { pts, avgZ };
      }).sort((a, b) => b.avgZ - a.avgZ);

      for (const face of faces) {
        ctx.beginPath();
        face.pts.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.scr.x, p.scr.y);
          else ctx.lineTo(p.scr.x, p.scr.y);
        });
        ctx.closePath();
        ctx.fillStyle = cols.fill;
        ctx.fill();
        ctx.strokeStyle = cols.stroke;
        ctx.lineWidth = b === selectedBox ? 2 : 1;
        ctx.stroke();
      }
    }

    function drawLabel(b, selectedBox) {
      // platforms: float above file cubes so the name isn't buried under them
      const lift = b.kind === "platform" ? 2.2 : 0.35;
      const top = project(b.x, b.y + b.h / 2 + lift, b.z);
      const showLabel =
        b.kind === "platform" || b === selectedBox || (top && top.z < 12);
      if (!showLabel || !top || top.z >= 45) return;
      const alpha = Math.max(0, Math.min(1, 1.3 - top.z / 40));
      ctx.save();
      ctx.globalAlpha = alpha;
      const size =
        b.kind === "platform"
          ? Math.max(12, Math.min(18, top.s * 0.4))
          : Math.max(10, Math.min(15, top.s * 0.32));
      ctx.font = `${b === selectedBox ? "bold " : ""}${size}px Hack, ui-monospace, monospace`;
      ctx.textAlign = "center";
      const tw = ctx.measureText(b.name).width;
      ctx.fillStyle = "rgba(10, 0, 24, 0.55)";
      ctx.fillRect(top.x - tw / 2 - 4, top.y - size, tw + 8, size + 6);
      ctx.fillStyle = b === selectedBox ? "#fff" : "#e8d0ff";
      ctx.fillText(b.name, top.x, top.y);
      ctx.restore();
    }

    function drawLink(l) {
      const a = project(l.x1, l.y1, l.z1);
      const b = project(l.x2, l.y2, l.z2);
      if (!a || !b) return;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = "rgba(180, 100, 255, 0.45)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    function selectable() {
      // Only this view's own files + immediate child folders. Files inside
      // child dirs are visible for context but require Enter to navigate first.
      const depth = viewSegs.length + 1;
      return boxes.filter(
        (b) =>
          (b.kind === "platform" || b.kind === "file") &&
          b.segs.length === depth
      );
    }

    // Left/right: all files on this platform (screen L→R), then child folders
    // (screen L→R). Pure screen-X order interleaved folders between files
    // because child platforms sit further up the scene.
    function screenOrdered() {
      const withX = (b) => ({ b, sx: project(b.x, b.y, b.z)?.x ?? Infinity });
      const files = selectable()
        .filter((b) => b.kind === "file")
        .map(withX)
        .sort((a, c) => a.sx - c.sx)
        .map((o) => o.b);
      const dirs = selectable()
        .filter((b) => b.kind === "platform")
        .map(withX)
        .sort((a, c) => a.sx - c.sx)
        .map((o) => o.b);
      return files.concat(dirs);
    }

    function moveSelection(delta) {
      const list = selectable();
      if (!list.length) return;
      const order = screenOrdered();
      const cur = list[selected];
      let idx = order.indexOf(cur);
      if (idx < 0) idx = 0;
      idx = (idx + delta + order.length) % order.length;
      selected = list.indexOf(order[idx]);
      ensureSelectionVisible();
    }

    // True when the box center projects into the safe viewport (with margin).
    // Behind-camera / clipped items count as off-screen.
    function isBoxVisible(box, pose) {
      const p = projectFrom(
        pose || cam,
        box.x,
        box.y + (box.h || 0) * 0.25,
        box.z
      );
      if (!p) return false;
      const m = Math.min(W, H) * 0.14;
      return p.x >= m && p.x <= W - m && p.y >= m && p.y <= H - m;
    }

    // project() against an arbitrary camera pose (does not touch `cam`).
    function projectFrom(pose, wx, wy, wz) {
      const cy = Math.cos(pose.yaw);
      const sy = Math.sin(pose.yaw);
      let x = (wx - pose.x) * cy - (wz - pose.z) * sy;
      let z = (wx - pose.x) * sy + (wz - pose.z) * cy;
      const cp = Math.cos(pose.pitch);
      const sp = Math.sin(pose.pitch);
      const y = (wy - pose.y) * cp - z * sp;
      z = (wy - pose.y) * sp + z * cp;
      if (z <= 0.15) return null;
      const fov = Math.min(W, H) * 0.9;
      return {
        x: W / 2 + (x / z) * fov,
        y: H / 2 - (y / z) * fov,
        z,
      };
    }

    // Stay on the current-folder overlook; only pan far enough that `box`
    // enters the safe viewport. Never adopts a child-folder overlook — Enter
    // keeps that distinct "fly into" beat.
    function frameSelection(box) {
      const root = rootPlatform();
      const home = root
        ? overlookFor(root)
        : {
            x: cam.x,
            y: cam.y,
            z: cam.z,
            yaw: Math.PI,
            pitch: -0.55,
          };

      const by = box.y + (box.h || 0) * 0.25;
      const m = Math.min(W, H) * 0.14;
      const fov = Math.min(W, H) * 0.9;

      const pose = { ...home };
      let p = projectFrom(pose, box.x, by, box.z);

      if (!p) {
        // Behind / clipped from the home overlook — slide laterally onto it.
        pose.x = box.x;
        p = projectFrom(pose, box.x, by, box.z);
      }

      if (p) {
        // Horizontal: nudge cam.x just past the margin (yaw≈π → screen-x ∝ cam.x).
        if (p.x < m || p.x > W - m) {
          const dxScreen = p.x < m ? m - p.x : W - m - p.x;
          pose.x += (dxScreen * p.z) / fov;
          p = projectFrom(pose, box.x, by, box.z);
        }
        // Depth: if still above/below the safe band (far child platforms),
        // ease forward a little — capped so we don't settle on the child.
        if (p && (p.y < m || p.y > H - m)) {
          const pull = Math.min(5, Math.abs(pose.z - (box.z + 12)));
          pose.z -= pull; // home sits +z of the scene; move toward children
        }
      }

      return pose;
    }

    function ensureSelectionVisible() {
      const box = selectable()[selected];
      if (!box) return;
      if (isBoxVisible(box)) return;
      animateCamTo(frameSelection(box), null, {
        dur: REFRAME_MS,
        kind: "reframe",
      });
    }

    function draw() {
      // deep SGI / JP void
      const g = ctx.createRadialGradient(W / 2, H * 0.4, 40, W / 2, H / 2, Math.max(W, H));
      g.addColorStop(0, "#1a0530");
      g.addColorStop(0.55, "#0a0018");
      g.addColorStop(1, "#000008");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      // faint ground grid under the root
      ctx.save();
      for (let i = -20; i <= 20; i++) {
        const a1 = project(i * 2, -0.4, -20);
        const a2 = project(i * 2, -0.4, 20);
        const b1 = project(-20, -0.4, i * 2);
        const b2 = project(20, -0.4, i * 2);
        ctx.strokeStyle = "rgba(120, 40, 180, 0.12)";
        ctx.lineWidth = 1;
        if (a1 && a2) {
          ctx.beginPath();
          ctx.moveTo(a1.x, a1.y);
          ctx.lineTo(a2.x, a2.y);
          ctx.stroke();
        }
        if (b1 && b2) {
          ctx.beginPath();
          ctx.moveTo(b1.x, b1.y);
          ctx.lineTo(b2.x, b2.y);
          ctx.stroke();
        }
      }
      ctx.restore();

      const selList = selectable();
      if (selected >= selList.length) selected = Math.max(0, selList.length - 1);
      const selectedBox = selList[selected] || null;

      // painter: far → near
      const drawables = boxes
        .filter((b) => b.kind !== "link")
        .map((b) => ({ b, z: project(b.x, b.y, b.z)?.z ?? 999 }))
        .sort((a, b) => b.z - a.z);

      for (const l of boxes.filter((b) => b.kind === "link")) drawLink(l);
      for (const { b } of drawables) drawBox(b, selectedBox);
      // labels after all geometry so folder names aren't buried under file cubes
      for (const { b } of drawables) drawLabel(b, selectedBox);

      // selection readout
      if (selectedBox) {
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect(16, H - 52, Math.min(W - 32, 520), 36);
        ctx.fillStyle = "#f0d0ff";
        ctx.font = "13px Hack, ui-monospace, monospace";
        ctx.textAlign = "left";
        const kind =
          selectedBox.kind === "platform"
            ? "dir"
            : selectedBox.locked
              ? "locked"
              : selectedBox.type;
        ctx.fillText(
          `[${kind}] ${pathStr(selectedBox.segs)}`,
          28,
          H - 28
        );
      }
    }

    // --- input / loop -------------------------------------------------------

    function moveCam(dt) {
      if (notepadEl) return;
      if (camAnim) {
        // Let WASD / Alt-look take over a selection reframe mid-flight.
        const steering =
          keys.w ||
          keys.s ||
          keys.a ||
          keys.d ||
          keys.q ||
          keys.e ||
          keys.PageUp ||
          keys.PageDown ||
          (keys.Alt &&
            (keys.ArrowLeft ||
              keys.ArrowRight ||
              keys.ArrowUp ||
              keys.ArrowDown));
        if (camAnim.kind === "reframe" && steering) camAnim = null;
        else return;
      }
      const speed = (keys.Shift ? 14 : 7) * dt;
      const forward = {
        x: Math.sin(cam.yaw),
        z: -Math.cos(cam.yaw),
      };
      const right = {
        x: Math.cos(cam.yaw),
        z: Math.sin(cam.yaw),
      };
      if (keys.w) {
        cam.x += forward.x * speed;
        cam.z += forward.z * speed;
      }
      if (keys.s) {
        cam.x -= forward.x * speed;
        cam.z -= forward.z * speed;
      }
      if (keys.a) {
        cam.x -= right.x * speed;
        cam.z -= right.z * speed;
      }
      if (keys.d) {
        cam.x += right.x * speed;
        cam.z += right.z * speed;
      }
      if (keys.q || keys.PageDown) cam.y -= speed;
      if (keys.e || keys.PageUp) cam.y += speed;

      // look with arrows (when not used as select — hold Alt for look-only;
      // default: left/right cycle selection, up/down look pitch lightly)
      if (keys.ArrowLeft && keys.Alt) cam.yaw -= 1.2 * dt;
      if (keys.ArrowRight && keys.Alt) cam.yaw += 1.2 * dt;
      if (keys.ArrowUp && keys.Alt) cam.pitch = Math.min(1.2, cam.pitch + 0.9 * dt);
      if (keys.ArrowDown && keys.Alt) cam.pitch = Math.max(-1.2, cam.pitch - 0.9 * dt);
    }

    function tick(now) {
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      updateCamAnim(dt);
      moveCam(dt);
      draw();
      raf = requestAnimationFrame(tick);
    }

    function enterFolder(sel) {
      if (camAnim) return;
      const dest = overlookFor(sel);
      animateCamTo(dest, () => {
        viewSegs = sel.segs.slice();
        // Relative overlook matches the pose we just flew to, so the cut is seamless.
        rebuild({ snapCam: true });
      });
    }

    function goUp() {
      if (camAnim) return;
      if (!viewSegs.length) return;
      const childSegs = viewSegs.slice();
      viewSegs = viewSegs.slice(0, -1);
      rebuild({ snapCam: false });
      const childPlat = boxes.find(
        (b) => b.kind === "platform" && sameSegs(b.segs, childSegs)
      );
      const parentPlat = rootPlatform();
      // Start framed on the folder we just left (same relative view as before),
      // then pull back to the parent overlook.
      if (childPlat) Object.assign(cam, overlookFor(childPlat));
      if (parentPlat) animateCamTo(overlookFor(parentPlat));
      else if (childPlat) Object.assign(cam, overlookFor(childPlat));
    }

    function openSelected() {
      if (camAnim) return;
      const sel = selectable()[selected];
      if (!sel) return;
      if (sel.kind === "platform") {
        if (!sameSegs(sel.segs, viewSegs)) enterFolder(sel);
        return;
      }

      const node = term.getNode(sel.segs);
      if (!node) return;

      if (sel.locked || node.locked) {
        close();
        term.denied();
        return;
      }
      if (node.type === "link") {
        close();
        term.openLink(node.url);
        term.printLine(node.content || `Opening ${node.url}...`);
        return;
      }
      // plain text — classic Windows notepad popup (stay in fsn)
      openNotepad(sel.name, node.content || "");
    }

    let notepadEl = null;

    function openNotepad(filename, content) {
      if (notepadEl) closeNotepad();

      const win = document.createElement("div");
      win.className = "fsn-notepad";
      win.setAttribute("role", "dialog");
      win.setAttribute("aria-label", filename);

      win.innerHTML =
        `<div class="fsn-notepad-titlebar">` +
        `<span class="fsn-notepad-title">${escapeHtml(filename)} - Notepad</span>` +
        `<button type="button" class="fsn-notepad-x" aria-label="Close">×</button>` +
        `</div>` +
        `<div class="fsn-notepad-menu" aria-hidden="true">` +
        `<span><u>F</u>ile</span><span><u>E</u>dit</span>` +
        `<span><u>S</u>earch</span><span><u>H</u>elp</span>` +
        `</div>` +
        `<pre class="fsn-notepad-body"></pre>` +
        `<div class="fsn-notepad-status">Read Only</div>`;

      win.querySelector(".fsn-notepad-body").textContent = content;
      win.querySelector(".fsn-notepad-x").addEventListener("click", (e) => {
        e.stopPropagation();
        closeNotepad();
      });
      // clicks inside the window shouldn't drag the 3D view
      win.addEventListener("pointerdown", (e) => e.stopPropagation());

      root.appendChild(win);
      notepadEl = win;
    }

    function closeNotepad() {
      if (!notepadEl) return;
      notepadEl.remove();
      notepadEl = null;
    }

    function escapeHtml(s) {
      return String(s).replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c]
      );
    }

    function close() {
      if (!term._fsnOpen) return;
      closeNotepad();
      term._fsnOpen = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      root.removeEventListener("pointerdown", onPtrDown);
      window.removeEventListener("pointermove", onPtrMove);
      window.removeEventListener("pointerup", onPtrUp);
      root.remove();
      term.focus();
    }

    function onKeyDown(e) {
      e.preventDefault();
      e.stopPropagation();
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      keys[k] = true;
      if (e.altKey) keys.Alt = true;
      if (e.shiftKey) keys.Shift = true;

      if (k === "Escape") {
        if (notepadEl) {
          closeNotepad();
          return;
        }
        close();
        return;
      }
      if (notepadEl) return;
      // Folder fly-to owns the keys; selection reframes stay interruptible.
      if (camAnim && camAnim.kind !== "reframe") return;
      if (k === "Enter") {
        openSelected();
        return;
      }
      if (k === "Backspace") {
        goUp();
        return;
      }
      // cycle selection by on-screen left→right order
      if (!selectable().length) return;
      if (k === "ArrowLeft" && !e.altKey) {
        moveSelection(-1);
      } else if (k === "ArrowRight" && !e.altKey) {
        moveSelection(1);
      } else if (k === "Tab") {
        moveSelection(e.shiftKey ? -1 : 1);
      } else if (k === "ArrowUp" && !e.altKey) {
        cam.pitch = Math.min(1.2, cam.pitch + 0.08);
      } else if (k === "ArrowDown" && !e.altKey) {
        cam.pitch = Math.max(-1.2, cam.pitch - 0.08);
      }
    }

    function onKeyUp(e) {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      keys[k] = false;
      if (!e.altKey) keys.Alt = false;
      if (!e.shiftKey) keys.Shift = false;
    }

    function onPtrDown(e) {
      if (notepadEl) return;
      if (camAnim) {
        if (camAnim.kind === "reframe") camAnim = null;
        else return;
      }
      pointerDragging = true;
      ptrMoved = false;
      lastPtr = { x: e.clientX, y: e.clientY };
      root.setPointerCapture?.(e.pointerId);
    }
    function onPtrMove(e) {
      if (!pointerDragging || !lastPtr) return;
      const dx = e.clientX - lastPtr.x;
      const dy = e.clientY - lastPtr.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) ptrMoved = true;
      cam.yaw += dx * 0.005;
      cam.pitch = Math.max(-1.2, Math.min(1.2, cam.pitch - dy * 0.005));
      lastPtr = { x: e.clientX, y: e.clientY };
    }
    function onPtrUp(e) {
      if (pointerDragging && !ptrMoved) {
        // tap: select nearest box under the pointer
        const list = selectable();
        let best = -1;
        let bestD = 48;
        for (let i = 0; i < list.length; i++) {
          const p = project(list[i].x, list[i].y, list[i].z);
          if (!p) continue;
          const d = Math.hypot(p.x - e.clientX, p.y - e.clientY);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
        if (best >= 0) selected = best;
      }
      pointerDragging = false;
      lastPtr = null;
    }

    window.addEventListener("resize", resize);
    // delay so the Enter that launched fsn doesn't immediately re-trigger
    setTimeout(() => {
      window.addEventListener("keydown", onKeyDown, true);
      window.addEventListener("keyup", onKeyUp, true);
    }, 120);
    root.addEventListener("pointerdown", onPtrDown);
    window.addEventListener("pointermove", onPtrMove);
    window.addEventListener("pointerup", onPtrUp);

    raf = requestAnimationFrame(tick);
  },
};
