/**
 * terminal.js — the engine.
 *
 * Owns the screen, the input line (with a custom block cursor), command
 * history, the fake-filesystem cwd, themes, the boot sequence, and a few
 * easter eggs. Reads commands from TERM.commands and content from TERM.fs.
 *
 * Loaded last (see index.html).
 */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const escapeHtml = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  const reducedMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  class Terminal {
    constructor() {
      this.screen = $("screen");
      this.output = $("output");
      this.inputLine = $("input-line");
      this.promptEl = this.inputLine.querySelector(".prompt");
      this.renderEl = this.inputLine.querySelector(".input-render");
      this.input = $("cmd");

      // resolved host: configured override, else the page's real hostname
      this.host =
        TERM.identity.host || window.location.hostname || "localhost";

      this.home = ["home", "guest"];
      this.cwd = this.home.slice();

      // user's mutable-FS overlay (created/edited nodes + delete tombstones),
      // persisted to localStorage. The seed (TERM.fs) stays read-only.
      this.loadOverlay();
      this._editorOpen = false;

      this.history = JSON.parse(localStorage.getItem("commandHistory") || "[]");
      this.historyIndex = this.history.length;

      this.skipBoot = false;
      this._bootResolvers = [];

      this.initTheme();
      this.bindInput();
      this.bindKonami();

      // reflect the resolved host in the window title bar
      const titleEl = document.querySelector(".titlebar .title");
      if (titleEl)
        titleEl.textContent = `${TERM.identity.user}@${this.host} — chsh`;
    }

    // --- theme -------------------------------------------------------------

    initTheme() {
      const saved = localStorage.getItem("theme");
      const theme = TERM.themes[saved] ? saved : TERM.defaultTheme;
      document.body.dataset.theme = theme;
    }

    setTheme(name) {
      document.body.dataset.theme = name;
      localStorage.setItem("theme", name);
    }

    // --- misc helpers exposed to commands ----------------------------------

    // shared PRNG so command handlers avoid Math.random lint noise
    random() {
      return pseudoRandom();
    }

    delay(ms) {
      return new Promise((res) => setTimeout(res, ms));
    }

    // Build a fullscreen overlay that any key or click dismisses. The
    // dismissing key is caught in the capture phase and swallowed so it
    // doesn't type into the input. Returns close(). opts: { autoMs, onClose,
    // delayMs }. Used by matrix(), hack(), and the locked-file bit can reuse.
    overlay(node, opts = {}) {
      const { autoMs, onClose, delayMs = 120 } = opts;
      document.body.appendChild(node);
      let dismissed = false;
      let autoTimer = null;
      const onKey = (e) => {
        e.preventDefault();
        e.stopPropagation();
        close();
      };
      const close = () => {
        if (dismissed) return;
        dismissed = true;
        if (autoTimer) clearTimeout(autoTimer);
        window.removeEventListener("keydown", onKey, true);
        node.removeEventListener("click", close);
        node.remove();
        if (onClose) onClose();
        this.focus();
      };
      // delay binding so the keypress that triggered this doesn't close it
      setTimeout(() => {
        window.addEventListener("keydown", onKey, true);
        node.addEventListener("click", close);
      }, delayMs);
      if (autoMs) autoTimer = setTimeout(close, autoMs);
      return close;
    }

    // --- filesystem helpers ------------------------------------------------

    resolve(input) {
      if (input == null || input === "") input = ".";
      let segs, rest;
      if (input === "~") return this.home.slice();
      if (input.startsWith("~/")) {
        segs = this.home.slice();
        rest = input.slice(2);
      } else if (input.startsWith("/")) {
        segs = [];
        rest = input.slice(1);
      } else {
        segs = this.cwd.slice();
        rest = input;
      }
      for (const part of rest.split("/")) {
        if (part === "" || part === ".") continue;
        if (part === "..") {
          if (segs.length) segs.pop();
          continue;
        }
        segs.push(part);
      }
      return segs;
    }

    // --- mutable FS: seed + overlay -----------------------------------------
    // The live filesystem is the read-only seed (TERM.fs) merged with a small
    // per-browser overlay of the user's changes:
    //   overlay.nodes:   { "<absPath>": node }   created OR edited nodes
    //   overlay.deleted: [ "<absPath>", ... ]    tombstones for seed nodes
    // getNode/listDir resolve against the merge; mutations write the overlay.

    loadOverlay() {
      let o = null;
      try {
        o = JSON.parse(localStorage.getItem("fs.overlay") || "null");
      } catch (_) {
        o = null;
      }
      this.overlay = o && typeof o === "object" ? o : {};
      if (!this.overlay.nodes) this.overlay.nodes = {};
      if (!Array.isArray(this.overlay.deleted)) this.overlay.deleted = [];
    }

    saveOverlay() {
      try {
        localStorage.setItem("fs.overlay", JSON.stringify(this.overlay));
      } catch (e) {
        // QuotaExceededError (~5 MB cap) — surface it to the command runner
        throw new Error("cannot save — storage full (try 'reset')");
      }
    }

    resetFs() {
      this.overlay = { nodes: {}, deleted: [] };
      try {
        localStorage.removeItem("fs.overlay");
      } catch (_) {
        /* ignore */
      }
    }

    // "/" for root, "/home/guest" for the home dir, etc.
    pathKey(segs) {
      return "/" + segs.join("/");
    }

    // walk the read-only seed only (ignores the overlay)
    seedNode(segs) {
      let cur = TERM.fs;
      for (const s of segs) {
        if (!cur || cur.type !== "dir" || !cur.children[s]) return null;
        cur = cur.children[s];
      }
      return cur;
    }

    // resolve a node against seed+overlay. null if missing or tombstoned (here
    // or at any ancestor). All single-node lookups (cat/cd/notFound) go here.
    getNode(segs) {
      // any tombstoned ancestor removes the whole subtree
      for (let i = 0; i <= segs.length; i++) {
        if (this.overlay.deleted.includes(this.pathKey(segs.slice(0, i))))
          return null;
      }
      const key = this.pathKey(segs);
      if (this.overlay.nodes[key]) return this.overlay.nodes[key];
      return this.seedNode(segs);
    }

    // back-compat alias: commands call ctx.term.node(...)
    node(segs) {
      return this.getNode(segs);
    }

    // children of a directory as { name: node }, merging seed children with
    // overlay-created children and removing tombstoned ones. null if not a dir.
    listDir(segs) {
      const dir = this.getNode(segs);
      if (!dir || dir.type !== "dir") return null;
      const out = {};
      const seedDir = this.seedNode(segs);
      if (seedDir && seedDir.type === "dir") {
        for (const [name, child] of Object.entries(seedDir.children))
          out[name] = child;
      }
      const dirKey = this.pathKey(segs);
      const prefix = dirKey === "/" ? "/" : dirKey + "/";
      const directChild = (k) => {
        if (!k.startsWith(prefix)) return null;
        const rest = k.slice(prefix.length);
        return rest && !rest.includes("/") ? rest : null;
      };
      for (const [k, child] of Object.entries(this.overlay.nodes)) {
        const name = directChild(k);
        if (name) out[name] = child;
      }
      for (const k of this.overlay.deleted) {
        const name = directChild(k);
        if (name) delete out[name];
      }
      return out;
    }

    // writes are sandboxed under the home directory; everything outside ~ acts
    // read-only (the "you don't have write access" illusion).
    canWrite(segs) {
      const homeKey = this.pathKey(this.home);
      return this.pathKey(segs).startsWith(homeKey + "/");
    }

    exists(segs) {
      return this.getNode(segs) != null;
    }

    writeFile(segs, content) {
      const key = this.pathKey(segs);
      this.overlay.nodes[key] = { type: "file", content };
      this.overlay.deleted = this.overlay.deleted.filter((k) => k !== key);
      this.saveOverlay();
    }

    mkdir(segs) {
      const key = this.pathKey(segs);
      this.overlay.nodes[key] = { type: "dir" };
      this.overlay.deleted = this.overlay.deleted.filter((k) => k !== key);
      this.saveOverlay();
    }

    // remove a node (and, with recursive, its whole subtree): drop any overlay
    // entries under it, and tombstone it if it's backed by the seed.
    remove(segs, opts = {}) {
      const key = this.pathKey(segs);
      const prefix = key === "/" ? "/" : key + "/";
      // drop the node and (if recursive) every overlay descendant
      for (const k of Object.keys(this.overlay.nodes)) {
        if (k === key || (opts.recursive && k.startsWith(prefix)))
          delete this.overlay.nodes[k];
      }
      // tombstone if the seed still provides it (ancestor check covers the
      // subtree, so tombstoning the top node is enough)
      if (this.seedNode(segs) && !this.overlay.deleted.includes(key))
        this.overlay.deleted.push(key);
      this.saveOverlay();
    }

    // deep-copy the node at srcSegs into dstSegs via the overlay. Files/links
    // are cloned verbatim (preserving link/locked); dirs recurse over listDir.
    // Used by mv (copy + remove) and cp.
    copyTree(srcSegs, dstSegs) {
      const node = this.getNode(srcSegs);
      if (!node) return false;
      if (node.type === "dir") {
        this.mkdir(dstSegs);
        const children = this.listDir(srcSegs) || {};
        for (const name of Object.keys(children))
          this.copyTree(srcSegs.concat(name), dstSegs.concat(name));
      } else {
        const clone = {};
        for (const k of Object.keys(node)) if (k !== "children") clone[k] = node[k];
        const dstKey = this.pathKey(dstSegs);
        this.overlay.nodes[dstKey] = clone;
        this.overlay.deleted = this.overlay.deleted.filter((k) => k !== dstKey);
        this.saveOverlay();
      }
      return true;
    }

    pwdString() {
      return "/" + this.cwd.join("/");
    }

    promptPath() {
      const abs = "/" + this.cwd.join("/");
      const homeAbs = "/" + this.home.join("/");
      if (abs === homeAbs) return "~";
      if (abs.startsWith(homeAbs + "/")) return "~" + abs.slice(homeAbs.length);
      return abs;
    }

    promptString() {
      const i = TERM.identity;
      return `${i.user}@${this.host}:${this.promptPath()}$`;
    }

    promptHTML() {
      const i = TERM.identity;
      return (
        `<span class="p-user">${escapeHtml(i.user)}</span>` +
        `<span class="p-at">@</span>` +
        `<span class="p-host">${escapeHtml(this.host)}</span>` +
        `<span class="p-sep">:</span>` +
        `<span class="p-path">${escapeHtml(this.promptPath())}</span>` +
        `<span class="p-sep">$</span> `
      );
    }

    // --- output ------------------------------------------------------------

    printLine(text) {
      const div = document.createElement("div");
      div.className = "line";
      div.textContent = text == null ? "" : String(text);
      this.output.appendChild(div);
      this.scrollToBottom();
    }

    printHTMLLine(html) {
      const div = document.createElement("div");
      div.className = "line";
      div.innerHTML = html;
      this.output.appendChild(div);
      this.scrollToBottom();
    }

    // wide pre-formatted output that should scroll horizontally rather than
    // wrap-break (ASCII art, aligned columns) — see .line.block in styles.css
    printBlock(text) {
      const div = document.createElement("div");
      div.className = "line block";
      div.textContent = text == null ? "" : String(text);
      this.output.appendChild(div);
      this.scrollToBottom();
    }

    // narrow screens get a compact banner; full banner would wrap/scroll ugly
    pickBanner() {
      const narrow = window.matchMedia("(max-width: 768px)").matches;
      return (narrow && TERM.bannerNarrow) || TERM.banner;
    }

    echoCommand(raw) {
      const div = document.createElement("div");
      div.className = "line";
      div.innerHTML = `<span class="prompt">${this.promptHTML()}</span>${escapeHtml(raw)}`;
      this.output.appendChild(div);
    }

    clearScreen() {
      this.output.innerHTML = "";
      this.scrollToBottom();
    }

    scrollToBottom() {
      this.screen.scrollTop = this.screen.scrollHeight;
    }

    // --- input line + custom cursor ---------------------------------------

    bindInput() {
      const rerender = () => this.renderInput();
      this.input.addEventListener("input", rerender);
      this.input.addEventListener("keyup", rerender);
      this.input.addEventListener("click", rerender);
      this.input.addEventListener("select", rerender);
      this.input.addEventListener("keydown", (e) => this.onKeyDown(e));

      // keep focus on the input whenever the user clicks the screen
      document.addEventListener("click", (e) => {
        if (this._editorOpen) return; // editor owns focus while open
        if (window.getSelection().toString()) return; // allow text selection
        this.focus();
      });
    }

    renderInput() {
      const v = this.input.value;
      const pos = this.input.selectionStart ?? v.length;
      const before = escapeHtml(v.slice(0, pos));
      const cur = escapeHtml(v.slice(pos, pos + 1) || " ");
      const after = escapeHtml(v.slice(pos + 1));
      this.renderEl.innerHTML =
        `${before}<span class="cursor">${cur}</span>${after}`;
      // keep overlay aligned if the native input scrolls horizontally
      this.renderEl.style.transform = `translateX(${-this.input.scrollLeft}px)`;
    }

    refreshPrompt() {
      this.promptEl.innerHTML = this.promptHTML();
    }

    focus() {
      this.input.focus();
    }

    onKeyDown(e) {
      if (e.key === "Enter") {
        e.preventDefault();
        const value = this.input.value;
        this.input.value = "";
        this.renderInput();
        this.submit(value);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (this.historyIndex > 0) {
          this.historyIndex--;
          this.input.value = this.history[this.historyIndex] ?? "";
          this.moveCursorToEnd();
        }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (this.historyIndex < this.history.length) {
          this.historyIndex++;
          this.input.value = this.history[this.historyIndex] ?? "";
          this.moveCursorToEnd();
        }
      } else if (e.key === "Tab") {
        e.preventDefault();
        this.autocomplete();
      } else if (e.ctrlKey && (e.key === "c" || e.key === "C")) {
        e.preventDefault();
        this.echoCommand(this.input.value + "^C");
        this.input.value = "";
        this.historyIndex = this.history.length;
        this.renderInput();
      } else if (e.ctrlKey && (e.key === "l" || e.key === "L")) {
        e.preventDefault();
        this.clearScreen();
      }
    }

    moveCursorToEnd() {
      const end = this.input.value.length;
      // defer so the value is committed before we set the range
      requestAnimationFrame(() => {
        this.input.setSelectionRange(end, end);
        this.renderInput();
      });
    }

    // --- autocomplete ------------------------------------------------------

    autocomplete() {
      const v = this.input.value;
      const tokens = v.split(/(\s+)/); // keep separators
      const lastToken = tokens[tokens.length - 1];
      const completingCommand = !/\s/.test(v.trimEnd()) && tokens.length <= 1;

      let matches, base, replace;
      if (completingCommand) {
        base = v;
        matches = Object.keys(TERM.commands)
          .filter((c) => !TERM.commands[c].hidden && c.startsWith(base))
          .sort();
        replace = (name) => name + " ";
      } else {
        // completing a path argument
        const slash = lastToken.lastIndexOf("/");
        const dirPart = slash >= 0 ? lastToken.slice(0, slash + 1) : "";
        const prefix = slash >= 0 ? lastToken.slice(slash + 1) : lastToken;
        const children = this.listDir(this.resolve(dirPart || "."));
        if (!children) return;
        base = prefix;
        const showHidden = prefix.startsWith(".");
        matches = Object.entries(children)
          .filter(([n]) => (showHidden || !n.startsWith(".")) && n.startsWith(prefix))
          .map(([n, child]) => n + (child.type === "dir" ? "/" : ""))
          .sort();
        replace = (name) => {
          const head = v.slice(0, v.length - lastToken.length);
          const suffix = name.endsWith("/") ? "" : " ";
          return head + dirPart + name + suffix;
        };
      }

      if (matches.length === 0) return;
      if (matches.length === 1) {
        this.input.value = replace(matches[0]);
        this.moveCursorToEnd();
        return;
      }
      // multiple: extend to longest common prefix, then list
      const lcp = longestCommonPrefix(matches.map((m) => m.replace(/\/$/, "")));
      if (lcp.length > base.length) {
        if (completingCommand) {
          this.input.value = lcp;
        } else {
          const head = v.slice(0, v.length - lastToken.length);
          const slash = lastToken.lastIndexOf("/");
          const dirPart = slash >= 0 ? lastToken.slice(0, slash + 1) : "";
          this.input.value = head + dirPart + lcp;
        }
        this.moveCursorToEnd();
      } else {
        this.echoCommand(v);
        this.printLine(matches.join("   "));
      }
    }

    // --- running commands --------------------------------------------------

    async submit(raw) {
      const trimmed = raw.trim();
      this.echoCommand(raw);
      if (!trimmed) {
        this.scrollToBottom();
        return;
      }

      this.history.push(trimmed);
      localStorage.setItem("commandHistory", JSON.stringify(this.history));
      this.historyIndex = this.history.length;

      await this.exec(trimmed);
      this.refreshPrompt();
      this.scrollToBottom();
    }

    // detect output redirection: `cmd > file` (truncate) or `cmd >> file`
    // (append). Supports a space-delimited operator or an attached target
    // (`>file`). The first operator wins. Returns null when there's no redirect.
    parseRedirect(input) {
      const tokens = input.split(/\s+/).filter(Boolean);
      for (let i = 0; i < tokens.length; i++) {
        const tk = tokens[i];
        let append, target;
        if (tk === ">" || tk === ">>") {
          append = tk === ">>";
          target = tokens[i + 1];
        } else if (tk.startsWith(">>")) {
          append = true;
          target = tk.slice(2);
        } else if (tk.startsWith(">")) {
          append = false;
          target = tk.slice(1);
        } else {
          continue;
        }
        if (!target) return { error: "syntax error near unexpected token `newline'" };
        return { command: tokens.slice(0, i).join(" "), target, append };
      }
      return null;
    }

    // run a redirect: capture the command's output (return value + any
    // print/printHTML/printBlock) and write/append it to the target file.
    async execRedirect(redir) {
      if (redir.error) {
        this.printLine("bash: " + redir.error);
        return;
      }
      let content = "";
      if (redir.command) {
        const parts = redir.command.split(/\s+/).filter(Boolean);
        const name = parts[0];
        const cmd = TERM.commands[name];
        if (!cmd) {
          this.printLine(this.notFound(name));
          return;
        }
        const buf = [];
        const push = (t) => buf.push(t == null ? "" : String(t));
        const capCtx = {
          print: push,
          printBlock: push,
          printHTML: (h) => buf.push(stripTags(h)),
          esc: escapeHtml,
          term: this,
        };
        try {
          const ret = await cmd.run(parts.slice(1), capCtx);
          if (ret != null && ret !== "") buf.push(String(ret));
        } catch (err) {
          this.printLine(`${name}: ${err && err.message ? err.message : "error"}`);
          return;
        }
        content = buf.join("\n");
      }

      const segs = this.resolve(redir.target);
      if (!this.canWrite(segs)) {
        this.printLine(`bash: ${redir.target}: Permission denied`);
        return;
      }
      const existing = this.getNode(segs);
      if (existing && existing.type === "dir") {
        this.printLine(`bash: ${redir.target}: Is a directory`);
        return;
      }
      const parent = this.getNode(segs.slice(0, -1));
      if (!parent || parent.type !== "dir") {
        this.printLine(`bash: ${redir.target}: No such file or directory`);
        return;
      }
      let final = content;
      if (redir.append && existing && existing.type === "file") {
        const prev = existing.content || "";
        final = prev + (prev && content ? "\n" : "") + content;
      }
      try {
        this.writeFile(segs, final);
      } catch (e) {
        this.printLine(`bash: ${e && e.message ? e.message : "write failed"}`);
      }
    }

    // run a command string without echoing the prompt (used by deep links too)
    async exec(input) {
      const redir = this.parseRedirect(input.trim());
      if (redir) return this.execRedirect(redir);

      const parts = input.trim().split(/\s+/);
      const name = parts[0];
      const args = parts.slice(1);
      const cmd = TERM.commands[name];

      if (!cmd) {
        this.printLine(this.notFound(name));
        return;
      }

      const ctx = {
        print: (t) => this.printLine(t),
        printHTML: (h) => this.printHTMLLine(h),
        printBlock: (t) => this.printBlock(t),
        esc: escapeHtml,
        term: this,
      };

      try {
        const out = await cmd.run(args, ctx);
        if (out != null && out !== "") this.printLine(out);
      } catch (err) {
        this.printLine(`${name}: ${err && err.message ? err.message : "error"}`);
      }
    }

    notFound(name) {
      // if there's a readable file by this name, nudge toward `cat`
      const candidates = [name, name + ".txt"];
      for (const c of candidates) {
        const inHome = this.node([...this.home, c]);
        const inCwd = this.node(this.resolve(c));
        const hit = inCwd || inHome;
        if (hit && hit.type === "file" && !hit.locked) {
          return `command not found: ${name}\nDid you mean: cat ${c}`;
        }
      }
      return `command not found: ${name} (try 'help')`;
    }

    // --- actions used by commands -----------------------------------------

    openLink(url) {
      if (!url || url.includes("REPLACE-ME")) {
        this.printLine("(link not configured yet — edit js/config.js)");
        return;
      }
      window.open(url, "_blank", "noopener");
    }

    denied() {
      this.printLine("Access denied.");
      this.printLine("ah ah ah! You didn't say the magic word!");
      const eggs = TERM.eggs || {};
      this.nedry(eggs.jurassicParkGif, eggs.jurassicParkAudio);
    }

    // The Jurassic Park bit: show a gif + play a sound if configured,
    // otherwise (or if an asset is missing) fall back to shake + beep.
    nedry(gifSrc, audioSrc) {
      const shake = () => {
        this.screen.classList.remove("shake");
        void this.screen.offsetWidth; // restart animation
        this.screen.classList.add("shake");
      };

      let audio = null;
      if (audioSrc) {
        audio = new Audio(audioSrc);
        audio.loop = true; // loop until the user dismisses
        audio.addEventListener("error", beep); // file missing -> beep instead
        // play() needs a user gesture; the Enter keypress counts. If it's
        // blocked (e.g. a ?cmd= deep link with no gesture), fail quietly.
        const p = audio.play();
        if (p && p.catch) p.catch(() => {});
      } else {
        beep();
      }

      if (!gifSrc) {
        shake();
        return;
      }

      const overlay = document.createElement("div");
      overlay.className = "jp-overlay";

      const img = document.createElement("img");
      img.alt = "ah ah ah! You didn't say the magic word!";

      const caption = document.createElement("p");
      caption.className = "jp-caption";
      caption.textContent = "ah ah ah! You didn't say the magic word!";

      const hint = document.createElement("p");
      hint.className = "jp-hint";
      hint.textContent = "(press any key)";

      let dismissed = false;
      const close = () => {
        if (dismissed) return;
        dismissed = true;
        overlay.remove();
        if (audio) audio.pause();
        window.removeEventListener("keydown", onKey, true);
        this.focus();
      };
      // swallow the dismissing key so it doesn't also type into the input
      const onKey = (e) => {
        e.preventDefault();
        e.stopPropagation();
        close();
      };

      // if the gif file isn't there, don't show a broken image — just shake
      img.onerror = () => {
        overlay.remove();
        shake();
      };
      img.src = gifSrc;

      overlay.appendChild(img);
      overlay.appendChild(caption);
      overlay.appendChild(hint);
      document.body.appendChild(overlay);

      // delay binding so the Enter keypress that triggered this doesn't
      // immediately close it; then any key or click dismisses
      setTimeout(() => {
        window.addEventListener("keydown", onKey, true);
        overlay.addEventListener("click", close);
      }, 150);
    }

    matrix() {
      if (document.querySelector(".matrix-overlay")) return;
      const canvas = document.createElement("canvas");
      canvas.className = "matrix-overlay";
      let raf;
      this.overlay(canvas, {
        autoMs: 8000,
        onClose: () => cancelAnimationFrame(raf),
      });
      const ctx = canvas.getContext("2d");
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const chars = "アイウエオカキクケコサシスセソ01010101".split("");
      const fontSize = 16;
      const cols = Math.floor(canvas.width / fontSize);
      const drops = new Array(cols).fill(1);
      const draw = () => {
        ctx.fillStyle = "rgba(0,0,0,0.06)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#0f0";
        ctx.font = fontSize + "px monospace";
        for (let i = 0; i < drops.length; i++) {
          const ch = chars[Math.floor(pseudoRandom() * chars.length)];
          ctx.fillText(ch, i * fontSize, drops[i] * fontSize);
          if (drops[i] * fontSize > canvas.height && pseudoRandom() > 0.975)
            drops[i] = 0;
          drops[i]++;
        }
        raf = requestAnimationFrame(draw);
      };
      this.printLine("Wake up, Neo... (press any key to exit)");
      draw();
    }

    // `vi`/`vim` — a full-screen, "looks-like-vi" editor (MVP). Modal in feel:
    // NORMAL (read-only) ↔ INSERT (`i`/`a`/`o`, Esc back) and a `:` command line
    // for :w / :q / :wq / :q! / :x (+ ! to force). Writes go through writeFile
    // and persist to the overlay. Not a real modal engine — no motions/yank.
    editor(segs, content, writable, name) {
      if (this._editorOpen) return;
      this._editorOpen = true;

      const overlay = document.createElement("div");
      overlay.className = "editor-overlay";

      const buffer = document.createElement("textarea");
      buffer.className = "editor-buffer";
      buffer.value = content;
      buffer.readOnly = true;
      buffer.spellcheck = false;
      buffer.setAttribute("autocapitalize", "off");
      buffer.setAttribute("autocomplete", "off");
      buffer.setAttribute("autocorrect", "off");

      const status = document.createElement("div");
      status.className = "editor-status";
      const msg = document.createElement("span");
      msg.className = "editor-status-msg";
      const cmd = document.createElement("input");
      cmd.className = "editor-cmd";
      cmd.type = "text";
      cmd.spellcheck = false;
      cmd.style.display = "none";
      const hint = document.createElement("span");
      hint.className = "editor-hint";
      hint.textContent = "i insert · Esc normal · :w write · :q quit";

      status.appendChild(msg);
      status.appendChild(cmd);
      status.appendChild(hint);
      overlay.appendChild(buffer);
      overlay.appendChild(status);
      document.body.appendChild(overlay);

      let mode = "normal";
      let original = content;
      const info = () => {
        const lines = buffer.value.length ? buffer.value.split("\n").length : 1;
        const bytes = buffer.value.length;
        const ro = writable ? "" : " [readonly]";
        const dirty = buffer.value !== original ? " [+]" : "";
        return `"${name}"${ro}${dirty} ${lines}L, ${bytes}B`;
      };
      const setStatus = (t) => {
        msg.textContent = t;
      };

      const enterInsert = () => {
        if (!writable) {
          setStatus("W10: Warning: Changing a readonly file");
        }
        mode = "insert";
        buffer.readOnly = false;
        if (writable) setStatus("-- INSERT --");
        buffer.focus();
      };
      const toNormal = (keepMsg) => {
        mode = "normal";
        buffer.readOnly = true;
        cmd.style.display = "none";
        if (!keepMsg) setStatus(info());
        buffer.focus();
      };
      const enterCommand = () => {
        mode = "command";
        setStatus("");
        cmd.style.display = "";
        cmd.value = ":";
        cmd.focus();
        cmd.setSelectionRange(1, 1);
      };

      const close = () => {
        if (!this._editorOpen) return;
        this._editorOpen = false;
        window.removeEventListener("keydown", onKey, true);
        overlay.remove();
        this.refreshPrompt();
        this.focus();
        this.scrollToBottom();
      };

      const write = () => {
        if (!writable) {
          setStatus("E212: Can't open file for writing (Permission denied)");
          return false;
        }
        try {
          this.writeFile(segs, buffer.value);
        } catch (e) {
          setStatus(e && e.message ? e.message : "E509: write failed");
          return false;
        }
        original = buffer.value;
        const lines = buffer.value.length ? buffer.value.split("\n").length : 1;
        setStatus(`"${name}" ${lines}L, ${buffer.value.length}B written`);
        return true;
      };

      const runEx = (raw) => {
        let s = (raw || "").trim().replace(/^:/, "");
        const force = s.endsWith("!");
        if (force) s = s.slice(0, -1);
        s = s.trim();
        const dirty = buffer.value !== original;
        if (s === "") {
          toNormal(false);
        } else if (s === "w") {
          const ok = write();
          toNormal(ok);
        } else if (s === "q") {
          if (dirty && !force) {
            toNormal(true);
            setStatus("E37: No write since last change (add ! to override)");
          } else {
            close();
          }
        } else if (s === "wq" || s === "x") {
          if (write()) close();
          else toNormal(true);
        } else {
          toNormal(true);
          setStatus(`E492: Not an editor command: ${s}`);
        }
      };

      // textarea owns NORMAL/INSERT keys; the command line owns COMMAND keys.
      // A capture-phase window listener keeps stray keys from leaking to the
      // terminal behind the overlay (konami/click-focus are already guarded).
      const onKey = (e) => {
        if (mode === "command") return; // the cmd input handles its own keys
        if (mode === "insert") {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            toNormal(false);
          }
          return; // let everything else type into the textarea
        }
        // normal mode: swallow keystrokes, act on the vi-ish ones
        e.preventDefault();
        e.stopPropagation();
        if ("iaoIAO".includes(e.key)) enterInsert();
        else if (e.key === ":") enterCommand();
      };
      window.addEventListener("keydown", onKey, true);

      cmd.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          runEx(cmd.value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          toNormal(false);
        }
      });
      // keep the leading ":" intact
      cmd.addEventListener("input", () => {
        if (!cmd.value.startsWith(":")) cmd.value = ":" + cmd.value;
      });

      setStatus(info());
      buffer.focus();
    }

    // `sl` — a steam locomotive chugs across the screen (the classic `ls`
    // typo gag). Pure CSS animation; respects reduced motion.
    steamLocomotive() {
      if (reducedMotion) {
        this.printLine(TRAIN);
        return;
      }
      if (document.querySelector(".sl-train")) return;
      const pre = document.createElement("pre");
      pre.className = "sl-train";
      pre.textContent = TRAIN;
      pre.addEventListener("animationend", () => pre.remove());
      document.body.appendChild(pre);
    }

    // `hack` — Hollywood hacking: a stream of cascading hex, then a big
    // "ACCESS GRANTED". Dismiss with any key/click or it auto-closes.
    hack(target) {
      if (document.querySelector(".hack-overlay")) return;
      const overlay = document.createElement("div");
      overlay.className = "hack-overlay";
      const stream = document.createElement("pre");
      stream.className = "hack-stream";
      const granted = document.createElement("div");
      granted.className = "hack-granted";
      granted.textContent = "ACCESS GRANTED";
      overlay.appendChild(stream);
      overlay.appendChild(granted);

      const HEX = "0123456789ABCDEF";
      const row = () => {
        let s = "";
        for (let i = 0; i < 64; i++) s += HEX[Math.floor(this.random() * 16)];
        return s;
      };
      const tick = () => {
        const lines = (stream.textContent + row() + "\n").split("\n");
        stream.textContent = lines.slice(-120).join("\n");
        stream.scrollTop = stream.scrollHeight;
      };

      const interval = setInterval(tick, 45);
      const reveal = setTimeout(() => {
        granted.classList.add("show");
        beep();
      }, 2200);

      const label = target ? ` ${target}` : "";
      this.printLine(`Hacking${label}... (press any key to abort)`);
      this.overlay(overlay, {
        autoMs: 5200,
        onClose: () => {
          clearInterval(interval);
          clearTimeout(reveal);
        },
      });
    }

    // `rm -rf /` gag — fake "deleting everything" progress, then "just
    // kidding". Returns a promise the command awaits.
    async fakeDelete() {
      const targets = [
        "/bin",
        "/boot",
        "/etc",
        "/home/guest",
        "/lib",
        "/usr",
        "/var",
        "the last 10 years of your photos",
        "your will to live",
      ];
      this.printLine("rm: descending into / — this cannot be undone.");
      const line = document.createElement("div");
      line.className = "line";
      this.output.appendChild(line);
      for (const t of targets) {
        line.textContent = `removing ${t} ...`;
        this.scrollToBottom();
        await this.delay(reducedMotion ? 0 : 900);
      }
      line.textContent = "removing / ... 100%";
      await this.delay(reducedMotion ? 0 : 1200);
      this.printLine("");
      this.printLine(
        "just kidding 😅  it's a fake filesystem — nothing was harmed."
      );
    }

    // Konami code (↑↑↓↓←→←→ B A) toggles a CRT scanline effect.
    bindKonami() {
      const seq = [
        "ArrowUp",
        "ArrowUp",
        "ArrowDown",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "ArrowLeft",
        "ArrowRight",
        "b",
        "a",
      ];
      let buf = [];
      window.addEventListener("keydown", (e) => {
        if (this._editorOpen) return; // don't capture keys while editing
        const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        buf.push(k);
        if (buf.length > seq.length) buf = buf.slice(-seq.length);
        if (buf.length === seq.length && seq.every((s, i) => s === buf[i])) {
          buf = [];
          this.toggleCRT();
        }
      });
    }

    toggleCRT() {
      const on = document.body.classList.toggle("crt");
      beep();
      this.printLine(
        on ? "CRT mode engaged ▒▓█ (Konami code accepted)" : "CRT mode off."
      );
      this.scrollToBottom();
      // clear the trailing "ba" that typed into the input as part of the code
      requestAnimationFrame(() => {
        this.input.value = "";
        this.renderInput();
      });
    }

    // --- boot --------------------------------------------------------------

    sleep(ms) {
      return new Promise((res) => {
        if (this.skipBoot) return res();
        const t = setTimeout(res, ms);
        this._bootResolvers.push(() => {
          clearTimeout(t);
          res();
        });
      });
    }

    flushBoot() {
      this.skipBoot = true;
      this._bootResolvers.splice(0).forEach((fn) => fn());
    }

    async typeLine(text, className) {
      const div = document.createElement("div");
      div.className = "line" + (className ? " " + className : "");
      this.output.appendChild(div);
      if (this.skipBoot || reducedMotion) {
        div.textContent = text;
        this.scrollToBottom();
        return;
      }
      for (let i = 0; i < text.length; i++) {
        div.textContent += text[i];
        this.scrollToBottom();
        await this.sleep(12);
      }
    }

    async boot() {
      const firstVisit = !localStorage.getItem("visited");
      const lastLogin = localStorage.getItem("loginTime");
      localStorage.setItem("loginTime", new Date().toString());
      localStorage.setItem("visited", "1");

      // a deep link (?cmd=...) jumps straight to content — skip the intro
      const deepLink = new URLSearchParams(window.location.search).get("cmd");

      // let the user skip the intro
      const skip = () => this.flushBoot();
      window.addEventListener("keydown", skip, { once: true });

      if (firstVisit && !reducedMotion && !deepLink) {
        await this.typeLine(`Connecting to ${this.host}...`, "dim");
        await this.sleep(150);
        await this.typeLine("Establishing secure channel ......... done", "dim");
        await this.typeLine("Negotiating handshake ............... done", "dim");
        await this.typeLine("Authenticating as guest ............. ok", "dim");
        await this.sleep(200);
        await this.typeLine("", "dim");
        await this.typeLine("Welcome to ChrisOS (web build).", "dim");
        await this.sleep(250);
      }

      window.removeEventListener("keydown", skip);

      if (lastLogin) this.printLine(`Last login: ${lastLogin}`);
      this.printBlock(this.pickBanner());

      // reveal the prompt and focus
      this.refreshPrompt();
      this.renderInput();
      this.inputLine.classList.remove("hidden");
      this.focus();
      this.scrollToBottom();

      // deep link: ?cmd=... (multiple commands may be separated by ';')
      if (deepLink) {
        const cmds = deepLink.split(";").map((c) => c.trim()).filter(Boolean);
        for (const c of cmds) {
          this.echoCommand(c);
          this.history.push(c);
          this.historyIndex = this.history.length;
          await this.exec(c);
        }
        this.refreshPrompt();
        this.scrollToBottom();
      }
    }
  }

  // --- small utilities -------------------------------------------------------

  // the classic `sl` steam locomotive (D51). String.raw keeps the backslashes.
  const TRAIN = String.raw`      ====        ________                ___________
  _D _|  |_______/        \__I_I_____===__|_________|
   |(_)---  |   H\________/ |   |        =|___ ___|
   /     |  |   H  |  |     |   |         ||_| |_||
  |      |  |   H  |__--------------------| [___] |
  | ________|___H__/__|_____/[][]~\_______|       |
  |/ |   |-----------I_____I [][] []  D   |=======|__
__/ =| o |=-~~\  /~~\  /~~\  /~~\ ____Y___________|__
 |/-=|___|=    ||    ||    ||    |_____/~\___/
  \_/      \O=====O=====O=====O_/      \_/`;

  // turn colorized HTML output (ls/tree) back into plain text for redirection
  function stripTags(html) {
    return String(html)
      .replace(/<[^>]*>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  function longestCommonPrefix(strs) {
    if (!strs.length) return "";
    let p = strs[0];
    for (const s of strs) {
      while (!s.startsWith(p)) p = p.slice(0, -1);
      if (!p) break;
    }
    return p;
  }

  // a deterministic-enough PRNG so we avoid Math.random lint noise; seeded by time
  let _seed = (Date.now ? Date.now() : 1) % 2147483647 || 1;
  function pseudoRandom() {
    _seed = (_seed * 16807) % 2147483647;
    return (_seed - 1) / 2147483646;
  }

  function beep() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ac = new Ctx();
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "square";
      osc.frequency.value = 220;
      gain.gain.value = 0.04;
      osc.connect(gain).connect(ac.destination);
      osc.start();
      osc.stop(ac.currentTime + 0.12);
    } catch (_) {
      /* no audio, no problem */
    }
  }

  // --- boot it up ------------------------------------------------------------

  const term = new Terminal();
  window.TERM_INSTANCE = term; // handy for debugging in the console
  term.boot();
})();
