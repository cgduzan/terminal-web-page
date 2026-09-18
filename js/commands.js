/**
 * commands.js — the command registry.
 *
 * Each command: { desc, usage?, hidden?, run(args, ctx) }
 *   - desc    one-line description (shown in `help` and `man`)
 *   - usage   optional usage string (shown in `man`)
 *   - hidden  excluded from `help`/autocomplete (easter eggs)
 *   - native  standard shell builtin (ls, cd, cat, vi, …) — excluded from
 *             `help` but still runs/autocompletes. Keeps `help` focused on the
 *             site's purpose: the about-me commands.
 *   - run     (args: string[], ctx) => string | void | Promise<...>
 *             Return a string to print it. Or use ctx.print / ctx.printHTML
 *             for richer/async output and return nothing.
 *
 * ctx provides:
 *   ctx.print(text)        append plain text (escaped)
 *   ctx.printHTML(html)    append raw HTML (escape inputs yourself with ctx.esc)
 *   ctx.esc(str)           HTML-escape a string
 *   ctx.term               the Terminal engine (cwd, fs helpers, theme, etc.)
 *
 * Loaded after config.js, before terminal.js.
 */

// --- shared helpers (filesystem commands) ---------------------------------

function readFileContent(arg, ctx, cmd) {
  const path = ctx.term.resolve(arg);
  const node = path && ctx.term.node(path);
  if (!node) return { error: `${cmd}: ${arg}: No such file or directory` };
  if (node.type === "dir") return { error: `${cmd}: ${arg}: Is a directory` };
  if (node.locked) {
    ctx.term.denied();
    return { error: null, denied: true };
  }
  if (!ctx.term.canRead(path)) {
    return { error: `${cmd}: ${arg}: Permission denied` };
  }
  if (node.type === "link") {
    return { content: node.content || `Opening ${node.url}...`, node };
  }
  return { content: node.content == null ? "" : String(node.content), node };
}

// resolve file args, or fall back to pipe/redirect stdin when none given
function inputsOrStdin(fileList, ctx, cmd, missingMsg) {
  if (!fileList.length) {
    if (ctx.stdin != null) return [{ name: "-", content: String(ctx.stdin) }];
    return { error: missingMsg || `${cmd}: missing file operand` };
  }
  const out = [];
  for (const arg of fileList) {
    const r = readFileContent(arg, ctx, cmd);
    if (r.denied) continue;
    if (r.error) {
      out.push({ error: r.error });
      continue;
    }
    out.push({ name: arg, content: r.content });
  }
  return out;
}

function parseLineCount(args, defaultN) {
  let n = defaultN;
  const files = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-n" && args[i + 1] != null) {
      const parsed = parseInt(args[++i], 10);
      if (!Number.isFinite(parsed) || parsed < 0)
        return { error: `invalid line count: ${args[i]}` };
      n = parsed;
      continue;
    }
    if (/^-\d+$/.test(a)) {
      n = parseInt(a.slice(1), 10);
      continue;
    }
    if (a.startsWith("-")) continue;
    files.push(a);
  }
  return { n, files };
}

function lsMode(child) {
  if (child.mode && /^[-dl][r-][w-][x-][r-][w-][x-][r-][w-][x-]$/.test(child.mode))
    return child.mode;
  if (child.locked) return "-r--------";
  if (child.type === "dir") return "drwxr-xr-x";
  if (child.type === "link") return "lrwxrwxrwx";
  return "-rw-r--r--";
}

function lsByteSize(child) {
  if (child.type === "dir") return 4096;
  return String(child.content == null ? "" : child.content).length;
}

function lsHumanSize(bytes) {
  if (bytes < 1024) return String(bytes);
  if (bytes < 1024 * 1024) {
    const k = bytes / 1024;
    return (k >= 10 ? k.toFixed(0) : k.toFixed(1)) + "K";
  }
  const m = bytes / (1024 * 1024);
  return (m >= 10 ? m.toFixed(0) : m.toFixed(1)) + "M";
}

const LS_DEFAULT_MTIME = "Sep 17 12:00";

function lsMtime(child) {
  if (child.mtime == null) return LS_DEFAULT_MTIME;
  const d = new Date(child.mtime);
  if (Number.isNaN(d.getTime())) return LS_DEFAULT_MTIME;
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const mon = months[d.getMonth()];
  const day = String(d.getDate()).padStart(2, " ");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${mon} ${day} ${hh}:${mm}`;
}

function lsNameHtml(name, child, esc) {
  if (child.type === "dir") return `<span class="fs-dir">${esc(name)}/</span>`;
  if (child.type === "link") return `<span class="fs-link">${esc(name)}</span>`;
  if (child.locked) return `<span class="fs-locked">${esc(name)}</span>`;
  return `<span class="fs-file">${esc(name)}</span>`;
}

function interpretEchoEscapes(s) {
  return String(s)
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "\r")
    .replace(/\\e/g, "\u001b")
    .replace(/\\\\/g, "\\");
}

function formatDirStack(term) {
  const abs = (segs) => "/" + segs.join("/");
  const homeAbs = abs(term.home);
  const pretty = (segs) => {
    const a = abs(segs);
    if (a === homeAbs) return "~";
    if (a.startsWith(homeAbs + "/")) return "~" + a.slice(homeAbs.length);
    return a;
  };
  const stack = [term.cwd].concat(term.dirstack.slice().reverse());
  return stack.map(pretty).join(" ");
}

// chmod mode: octal 3-digit (e.g. 644) or symbolic u/g/o/a ± rwx (simple)
function applyChmodMode(currentMode, spec) {
  const type = currentMode[0] || "-";
  let chars = currentMode.slice(1).split("");
  if (chars.length !== 9) chars = "rw-r--r--".split("");

  if (/^[0-7]{3,4}$/.test(spec)) {
    const oct = spec.slice(-3);
    const map = (n) => {
      const v = parseInt(n, 8);
      return [
        v & 4 ? "r" : "-",
        v & 2 ? "w" : "-",
        v & 1 ? "x" : "-",
      ];
    };
    chars = map(oct[0]).concat(map(oct[1]), map(oct[2]));
    return type + chars.join("");
  }

  // symbolic: [ugoa]*[+-=][rwx]+  (one clause)
  const m = spec.match(/^([ugoa]*)([+-=])([rwx]+)$/);
  if (!m) return null;
  let who = m[1] || "a";
  if (who === "a") who = "ugo";
  const op = m[2];
  const bits = m[3];
  const idx = { u: 0, g: 3, o: 6 };
  const bitPos = { r: 0, w: 1, x: 2 };
  for (const w of who) {
    const base = idx[w];
    if (base == null) continue;
    if (op === "=") {
      chars[base] = "-";
      chars[base + 1] = "-";
      chars[base + 2] = "-";
    }
    for (const b of bits) {
      const p = base + bitPos[b];
      if (op === "+" || op === "=") chars[p] = b;
      else if (op === "-") chars[p] = "-";
    }
  }
  return type + chars.join("");
}

TERM.commands = {
  help: {
    desc: "List available commands",
    native: true,
    run() {
      const names = Object.entries(TERM.commands)
        .filter(([, c]) => !c.hidden && !c.native)
        .map(([name]) => name)
        .sort();
      const rows = names
        .map((n) => `  ${n.padEnd(12)}${TERM.commands[n].desc}`)
        .join("\n");
      return `What you can do here:\n\n${rows}\n\nStandard shell commands (ls, cd, cat, vi, …) work too — try them, or Tab to autocomplete.\nTip: 'man <command>' for details. ↑/↓ for history.\nFiles you create or edit are saved in this browser only — 'reset' clears them.`;
    },
  },

  man: {
    desc: "Show the manual for a command",
    native: true,
    usage: "man <command>",
    run(args) {
      const name = args[0];
      if (!name) return "What manual page do you want? Try 'man ls'.";
      const cmd = TERM.commands[name];
      if (!cmd) return `No manual entry for ${name}`;
      let out = `NAME\n    ${name} — ${cmd.desc}`;
      if (cmd.usage) out += `\n\nUSAGE\n    ${cmd.usage}`;
      return out;
    },
  },

  clear: {
    desc: "Clear the screen",
    native: true,
    run(_args, ctx) {
      ctx.term.clearScreen();
    },
  },

  echo: {
    desc: "Print text back",
    native: true,
    usage: "echo [-ne] <text>",
    flags: ["-n", "-e", "-E"],
    run(args, ctx) {
      let noNewline = false;
      let escapes = false;
      let i = 0;
      while (i < args.length && /^-[neE]+$/.test(args[i])) {
        for (const c of args[i].slice(1)) {
          if (c === "n") noNewline = true;
          if (c === "e") escapes = true;
          if (c === "E") escapes = false;
        }
        i++;
      }
      let s = args.slice(i).join(" ");
      if (escapes) s = interpretEchoEscapes(s);
      if (ctx.capture) return noNewline ? s : s + "\n";
      return s;
    },
  },

  date: {
    desc: "Show the current date and time",
    native: true,
    run() {
      return new Date().toString();
    },
  },

  whoami: {
    desc: "Print the current user",
    native: true,
    run() {
      return TERM.identity.user;
    },
  },

  hostname: {
    desc: "Print the hostname",
    native: true,
    run(_args, ctx) {
      return ctx.term.host;
    },
  },

  history: {
    desc: "Show command history",
    native: true,
    run(_args, ctx) {
      const h = ctx.term.history;
      if (!h.length) return "No history yet.";
      return h.map((c, i) => `  ${String(i + 1).padStart(3)}  ${c}`).join("\n");
    },
  },

  // --- filesystem ----------------------------------------------------------

  pwd: {
    desc: "Print the working directory",
    native: true,
    run(_args, ctx) {
      return ctx.term.pwdString();
    },
  },

  ls: {
    desc: "List directory contents",
    native: true,
    usage: "ls [-alh] [path]",
    flags: ["-a", "-l", "-h", "-la", "-al", "-lh", "-hl", "-alh", "-lah", "-hla"],
    run(args, ctx) {
      const flags = args.filter((a) => a.startsWith("-")).join("");
      const showHidden = flags.includes("a");
      const longFmt = flags.includes("l");
      const human = flags.includes("h");
      const target = args.find((a) => !a.startsWith("-"));
      const path = ctx.term.resolve(target || ".");
      const node = path && ctx.term.node(path);
      if (!node)
        return `ls: cannot access '${target}': No such file or directory`;

      const user = TERM.identity.user;
      const formatSize = (bytes) =>
        human ? lsHumanSize(bytes) : String(bytes);

      const longLine = (name, child, sizeWidth) => {
        const mode = lsMode(child);
        const nlink = child.type === "dir" ? "2" : "1";
        const size = formatSize(lsByteSize(child)).padStart(sizeWidth);
        const mtime = lsMtime(child);
        const meta = `${mode}  ${nlink} ${user} ${user} ${size} ${mtime} `;
        return ctx.esc(meta) + lsNameHtml(name, child, ctx.esc);
      };

      if (node.type !== "dir") {
        const name = target || ".";
        if (!longFmt) {
          ctx.printHTML(lsNameHtml(name, node, ctx.esc));
          return;
        }
        const sizeStr = formatSize(lsByteSize(node));
        ctx.printHTML(longLine(name, node, sizeStr.length));
        return;
      }

      const entries = Object.entries(ctx.term.listDir(path))
        .filter(([name]) => showHidden || !name.startsWith("."))
        .sort(([a], [b]) => a.localeCompare(b));

      if (!longFmt) {
        if (!entries.length) {
          ctx.print("");
          return;
        }
        const html = entries
          .map(([name, child]) => lsNameHtml(name, child, ctx.esc))
          .join("   ");
        ctx.printHTML(html);
        return;
      }

      const sizes = entries.map(([, child]) => formatSize(lsByteSize(child)));
      const sizeWidth = sizes.reduce((w, s) => Math.max(w, s.length), 1);
      const totalBlocks = entries.reduce(
        (sum, [, child]) => sum + Math.ceil(lsByteSize(child) / 1024),
        0
      );
      const lines = [`total ${totalBlocks}`].concat(
        entries.map(([name, child]) => longLine(name, child, sizeWidth))
      );
      ctx.printHTML(lines.join("\n"));
    },
  },

  cd: {
    desc: "Change directory",
    native: true,
    usage: "cd [-|path]",
    flags: ["-"],
    run(args, ctx) {
      let target = args[0] || "~";
      let printPath = false;
      if (target === "-") {
        if (!ctx.term.oldpwd) return "cd: OLDPWD not set";
        target = "/" + ctx.term.oldpwd.join("/");
        printPath = true;
      }
      const path = ctx.term.resolve(target);
      const node = path && ctx.term.node(path);
      if (!node) return `cd: no such file or directory: ${args[0] || target}`;
      if (node.type !== "dir") return `cd: not a directory: ${args[0] || target}`;
      ctx.term.setCwd(path);
      if (printPath) return ctx.term.pwdString();
    },
  },

  pushd: {
    desc: "Push directory onto stack and cd",
    native: true,
    usage: "pushd [path]",
    run(args, ctx) {
      const target = args[0] || "~";
      const path = ctx.term.resolve(target);
      const node = path && ctx.term.node(path);
      if (!node) return `pushd: no such file or directory: ${target}`;
      if (node.type !== "dir") return `pushd: not a directory: ${target}`;
      ctx.term.dirstack.push(ctx.term.cwd.slice());
      ctx.term.setCwd(path);
      return formatDirStack(ctx.term);
    },
  },

  popd: {
    desc: "Pop directory from stack and cd",
    native: true,
    usage: "popd",
    run(_args, ctx) {
      if (!ctx.term.dirstack.length) return "popd: directory stack empty";
      const next = ctx.term.dirstack.pop();
      ctx.term.setCwd(next);
      return formatDirStack(ctx.term);
    },
  },

  dirs: {
    desc: "Display the directory stack",
    native: true,
    usage: "dirs",
    run(_args, ctx) {
      return formatDirStack(ctx.term);
    },
  },

  cat: {
    desc: "Print a file's contents",
    native: true,
    usage: "cat <file>",
    run(args, ctx) {
      const inputs = inputsOrStdin(
        args,
        ctx,
        "cat",
        "cat: missing file operand. Try 'cat about.txt'."
      );
      if (inputs.error) return inputs.error;
      const out = [];
      for (const item of inputs) {
        if (item.error) {
          out.push(item.error);
          continue;
        }
        if (item.name !== "-") {
          const path = ctx.term.resolve(item.name);
          const node = path && ctx.term.node(path);
          if (node && node.type === "link") ctx.term.openLink(node.url);
        }
        out.push(item.content);
      }
      return out.join("\n");
    },
  },

  head: {
    desc: "Print the first lines of a file",
    native: true,
    usage: "head [-n N] <file>",
    flags: ["-n"],
    run(args, ctx) {
      const parsed = parseLineCount(args, 10);
      if (parsed.error) return `head: ${parsed.error}`;
      const inputs = inputsOrStdin(parsed.files, ctx, "head");
      if (inputs.error) return inputs.error;
      const out = [];
      const multi = inputs.length > 1;
      for (const item of inputs) {
        if (item.error) {
          out.push(item.error);
          continue;
        }
        const lines = String(item.content).split("\n").slice(0, parsed.n);
        if (multi) out.push(`==> ${item.name} <==`);
        out.push(lines.join("\n"));
      }
      return out.join("\n");
    },
  },

  tail: {
    desc: "Print the last lines of a file",
    native: true,
    usage: "tail [-n N] <file>",
    flags: ["-n"],
    run(args, ctx) {
      const parsed = parseLineCount(args, 10);
      if (parsed.error) return `tail: ${parsed.error}`;
      const inputs = inputsOrStdin(parsed.files, ctx, "tail");
      if (inputs.error) return inputs.error;
      const out = [];
      const multi = inputs.length > 1;
      for (const item of inputs) {
        if (item.error) {
          out.push(item.error);
          continue;
        }
        const all = String(item.content).split("\n");
        const lines = all.slice(Math.max(0, all.length - parsed.n));
        if (multi) out.push(`==> ${item.name} <==`);
        out.push(lines.join("\n"));
      }
      return out.join("\n");
    },
  },

  wc: {
    desc: "Count lines, words, and bytes",
    native: true,
    usage: "wc [-lwc] <file>",
    flags: ["-l", "-w", "-c", "-lw", "-lc", "-wc", "-lwc"],
    run(args, ctx) {
      const flags = args.filter((a) => a.startsWith("-")).join("");
      const files = args.filter((a) => !a.startsWith("-"));
      const inputs = inputsOrStdin(
        files,
        ctx,
        "wc",
        "wc: no stdin here — pass a file"
      );
      if (inputs.error) return inputs.error;
      const any =
        flags.includes("l") || flags.includes("w") || flags.includes("c");
      const wantL = any ? flags.includes("l") : true;
      const wantW = any ? flags.includes("w") : true;
      const wantC = any ? flags.includes("c") : true;
      const out = [];
      for (const item of inputs) {
        if (item.error) {
          out.push(item.error);
          continue;
        }
        const text = String(item.content);
        const lineCount = (text.match(/\n/g) || []).length;
        const wordCount = (text.match(/\S+/g) || []).length;
        const byteCount = text.length;
        const cols = [];
        if (wantL) cols.push(String(lineCount).padStart(7));
        if (wantW) cols.push(String(wordCount).padStart(7));
        if (wantC) cols.push(String(byteCount).padStart(7));
        if (item.name !== "-") cols.push(item.name);
        out.push(cols.join(" "));
      }
      return out.join("\n");
    },
  },

  uname: {
    desc: "Print system information",
    native: true,
    usage: "uname [-a]",
    flags: ["-a"],
    run(args, ctx) {
      const flags = args.filter((a) => a.startsWith("-")).join("");
      if (flags.includes("a")) {
        const host = ctx.term.host;
        return `ChrisOS ${host} 6.1.0-chrisos #1 SMP PREEMPT_DYNAMIC ChrisOS web x86_64 GNU/Linux`;
      }
      return "ChrisOS";
    },
  },

  tree: {
    desc: "Show the directory tree",
    native: true,
    usage: "tree [path]",
    run(args, ctx) {
      const path = ctx.term.resolve(args[0] || ".");
      const node = path && ctx.term.node(path);
      if (!node) return `tree: ${args[0]}: No such file or directory`;
      const lines = [args[0] || "."];
      const walk = (segs, prefix) => {
        const children = ctx.term.listDir(segs);
        if (!children) return;
        const entries = Object.entries(children)
          .filter(([name]) => !name.startsWith("."))
          .sort(([a], [b]) => a.localeCompare(b));
        entries.forEach(([name, child], i) => {
          const last = i === entries.length - 1;
          const branch = last ? "└── " : "├── ";
          const suffix = child.type === "dir" ? "/" : "";
          lines.push(prefix + branch + name + suffix);
          if (child.type === "dir")
            walk(segs.concat(name), prefix + (last ? "    " : "│   "));
        });
      };
      walk(path, "");
      ctx.printBlock(lines.join("\n"));
    },
  },

  grep: {
    desc: "Print lines matching a pattern",
    native: true,
    usage: "grep [-in] <pattern> [file...]",
    flags: ["-i", "-n", "-in", "-ni"],
    run(args, ctx) {
      const flags = args.filter((a) => a.startsWith("-") && a !== "-").join("");
      const rest = args.filter((a) => !a.startsWith("-") || a === "-");
      // allow `grep - pattern` via stdin only; first non-flag is pattern
      const ignoreCase = flags.includes("i");
      const showNum = flags.includes("n");
      if (!rest.length) return "grep: missing pattern";
      const pattern = rest[0];
      const files = rest.slice(1);
      let re;
      try {
        re = new RegExp(pattern, ignoreCase ? "i" : "");
      } catch (e) {
        return `grep: invalid pattern: ${e.message}`;
      }
      const inputs = inputsOrStdin(
        files,
        ctx,
        "grep",
        "grep: no stdin here — pass a file or pipe into grep"
      );
      if (inputs.error) return inputs.error;
      const out = [];
      const multi = inputs.filter((x) => !x.error).length > 1;
      for (const item of inputs) {
        if (item.error) {
          out.push(item.error);
          continue;
        }
        const lines = String(item.content).split("\n");
        lines.forEach((line, idx) => {
          if (!re.test(line)) return;
          let prefix = "";
          if (multi && item.name !== "-") prefix += item.name + ":";
          if (showNum) prefix += idx + 1 + ":";
          out.push(prefix + line);
        });
      }
      return out.join("\n");
    },
  },

  find: {
    desc: "Walk a directory tree",
    native: true,
    usage: "find [path] [-name pattern]",
    flags: ["-name"],
    run(args, ctx) {
      let startArg = ".";
      let namePat = null;
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "-name" && args[i + 1] != null) {
          namePat = args[++i];
          continue;
        }
        if (args[i].startsWith("-")) continue;
        startArg = args[i];
      }
      const start = ctx.term.resolve(startArg);
      const node = start && ctx.term.node(start);
      if (!node) return `find: '${startArg}': No such file or directory`;

      const matchName = (name) => {
        if (!namePat) return true;
        const re = new RegExp(
          "^" +
            namePat
              .replace(/[.+^${}()|[\]\\]/g, "\\$&")
              .replace(/\*/g, ".*")
              .replace(/\?/g, ".") +
            "$"
        );
        return re.test(name);
      };

      const showPath = (segs) => {
        if (startArg === ".") {
          const rel = segs.slice(start.length).join("/");
          return rel ? "./" + rel : ".";
        }
        return "/" + segs.join("/");
      };

      const lines = [];
      const walk = (segs) => {
        const n = ctx.term.node(segs);
        if (!n) return;
        const base =
          segs.length === 0 ? "/" : segs[segs.length - 1];
        if (segs.length === start.length) {
          if (!namePat || matchName(base)) lines.push(showPath(segs));
        } else if (matchName(base)) {
          lines.push(showPath(segs));
        }
        if (n.type !== "dir") return;
        const children = ctx.term.listDir(segs) || {};
        for (const name of Object.keys(children).sort())
          walk(segs.concat(name));
      };
      walk(start);
      return lines.join("\n");
    },
  },

  which: {
    desc: "Locate a command",
    native: true,
    usage: "which <command>",
    run(args, ctx) {
      if (!args.length) return "which: missing operand";
      const aliases = ctx.term.allAliases();
      const out = [];
      for (const name of args) {
        if (TERM.commands[name] || aliases[name]) {
          out.push(`/bin/${name}`);
        } else {
          out.push(
            `which: no ${name} in (/usr/local/bin:/usr/bin:/bin)`
          );
        }
      }
      return out.join("\n");
    },
  },

  env: {
    desc: "Print environment variables",
    native: true,
    usage: "env",
    run(_args, ctx) {
      const env = Object.assign(
        {
          HOME: "/home/guest",
          USER: TERM.identity.user,
          LOGNAME: TERM.identity.user,
          PATH: "/usr/local/bin:/usr/bin:/bin",
          EDITOR: "vim",
          TERM: "xterm-256color",
          HOSTNAME: ctx.term.host,
          PWD: ctx.term.pwdString(),
          SHELL: "/bin/bash",
        },
        TERM.fakeEnv || {}
      );
      if (ctx.term.oldpwd)
        env.OLDPWD = "/" + ctx.term.oldpwd.join("/");
      return Object.keys(env)
        .sort()
        .map((k) => `${k}=${env[k]}`)
        .join("\n");
    },
  },

  chmod: {
    desc: "Change file mode bits",
    native: true,
    usage: "chmod <mode> <file>",
    run(args, ctx) {
      if (args.length < 2) return "chmod: missing operand";
      const modeSpec = args[0];
      const targets = args.slice(1);
      const out = [];
      for (const arg of targets) {
        const segs = ctx.term.resolve(arg);
        const node = ctx.term.getNode(segs);
        if (!node) {
          out.push(`chmod: cannot access '${arg}': No such file or directory`);
          continue;
        }
        if (!ctx.term.canWrite(segs)) {
          out.push(`chmod: changing permissions of '${arg}': Operation not permitted`);
          continue;
        }
        const next = applyChmodMode(lsMode(node), modeSpec);
        if (!next) {
          out.push(`chmod: invalid mode: '${modeSpec}'`);
          return out.join("\n");
        }
        ctx.term.patchNode(segs, { mode: next });
      }
      return out.join("\n");
    },
  },

  less: {
    desc: "Page through a file",
    native: true,
    usage: "less <file>",
    run(args, ctx) {
      const inputs = inputsOrStdin(args, ctx, "less");
      if (inputs.error) return inputs.error;
      const parts = [];
      for (const item of inputs) {
        if (item.error) return item.error;
        parts.push(item.content);
      }
      const text = parts.join("\n");
      if (ctx.capture) return text;
      ctx.term.pager(text, { forwardOnly: false });
    },
  },

  more: {
    desc: "Page through a file (forward only)",
    native: true,
    usage: "more <file>",
    run(args, ctx) {
      const inputs = inputsOrStdin(args, ctx, "more");
      if (inputs.error) return inputs.error;
      const parts = [];
      for (const item of inputs) {
        if (item.error) return item.error;
        parts.push(item.content);
      }
      const text = parts.join("\n");
      if (ctx.capture) return text;
      ctx.term.pager(text, { forwardOnly: true });
    },
  },

  alias: {
    desc: "Define or list command aliases",
    native: true,
    usage: "alias [name[=value]]",
    run(args, ctx) {
      if (!args.length) {
        const all = ctx.term.allAliases();
        return Object.keys(all)
          .sort()
          .map((k) => `alias ${k}='${all[k]}'`)
          .join("\n");
      }
      const out = [];
      for (const a of args) {
        const eq = a.indexOf("=");
        if (eq === -1) {
          const all = ctx.term.allAliases();
          if (all[a] != null) out.push(`alias ${a}='${all[a]}'`);
          else out.push(`bash: alias: ${a}: not found`);
          continue;
        }
        const name = a.slice(0, eq);
        let val = a.slice(eq + 1);
        if (
          (val.startsWith("'") && val.endsWith("'")) ||
          (val.startsWith('"') && val.endsWith('"'))
        )
          val = val.slice(1, -1);
        if (!name) return "bash: alias: invalid name";
        ctx.term.sessionAliases[name] = val;
      }
      return out.join("\n");
    },
  },

  touch: {
    desc: "Create an empty file",
    native: true,
    usage: "touch <file>",
    run(args, ctx) {
      if (!args.length) return "touch: missing file operand";
      const out = [];
      for (const arg of args) {
        const segs = ctx.term.resolve(arg);
        const node = ctx.term.getNode(segs);
        if (node && node.type === "dir") {
          out.push(`touch: cannot touch '${arg}': Is a directory`);
          continue;
        }
        if (node) {
          if (!ctx.term.canModify(segs)) {
            out.push(`touch: cannot touch '${arg}': Permission denied`);
            continue;
          }
        } else if (!ctx.term.canWriteDir(segs.slice(0, -1))) {
          out.push(`touch: cannot touch '${arg}': Permission denied`);
          continue;
        }
        const parent = ctx.term.getNode(segs.slice(0, -1));
        if (!parent || parent.type !== "dir") {
          out.push(`touch: cannot touch '${arg}': No such file or directory`);
          continue;
        }
        ctx.term.writeFile(segs, node && node.type === "file" ? node.content : "");
      }
      return out.join("\n");
    },
  },

  mkdir: {
    desc: "Create a directory",
    native: true,
    usage: "mkdir <dir>",
    run(args, ctx) {
      if (!args.length) return "mkdir: missing operand";
      const out = [];
      for (const arg of args) {
        const segs = ctx.term.resolve(arg);
        if (ctx.term.exists(segs)) {
          out.push(`mkdir: cannot create directory '${arg}': File exists`);
          continue;
        }
        const parentSegs = segs.slice(0, -1);
        if (!ctx.term.canWriteDir(parentSegs)) {
          out.push(`mkdir: cannot create directory '${arg}': Permission denied`);
          continue;
        }
        const parent = ctx.term.getNode(parentSegs);
        if (!parent || parent.type !== "dir") {
          out.push(`mkdir: cannot create directory '${arg}': No such file or directory`);
          continue;
        }
        ctx.term.mkdir(segs);
      }
      return out.join("\n");
    },
  },

  rm: {
    desc: "Remove files or directories",
    native: true,
    usage: "rm [-rf] <path>",
    flags: ["-r", "-f", "-rf", "-fr"],
    run(args, ctx) {
      const flags = args.filter((a) => a.startsWith("-")).join("");
      const targets = args.filter((a) => !a.startsWith("-"));
      const recursive = flags.includes("r");
      const force = flags.includes("f");
      // the dramatic "rm -rf /" gag still fires for the classic roots
      const roots = ["/", "/*", "~", "~/*", "."];
      if (recursive && force && targets.some((t) => roots.includes(t)))
        return ctx.term.fakeDelete();
      if (!targets.length) return "rm: missing operand";
      const out = [];
      for (const arg of targets) {
        const segs = ctx.term.resolve(arg);
        const node = ctx.term.getNode(segs);
        if (!node) {
          out.push(`rm: cannot remove '${arg}': No such file or directory`);
          continue;
        }
        // unlink needs write on the parent directory (chmod 400 files can still be rm'd)
        if (!ctx.term.canWriteDir(segs.slice(0, -1))) {
          out.push(`rm: cannot remove '${arg}': Permission denied`);
          continue;
        }
        if (node.type === "dir" && !recursive) {
          out.push(`rm: cannot remove '${arg}': Is a directory`);
          continue;
        }
        ctx.term.remove(segs, { recursive });
      }
      // if we deleted the directory we were standing in, retreat home
      if (!ctx.term.exists(ctx.term.cwd)) ctx.term.setCwd(ctx.term.home);
      return out.join("\n");
    },
  },

  cp: {
    desc: "Copy a file or directory",
    native: true,
    usage: "cp [-r] <src> <dst>",
    flags: ["-r", "-R"],
    run(args, ctx) {
      const t = ctx.term;
      const flags = args.filter((a) => a.startsWith("-")).join("");
      const recursive = flags.includes("r") || flags.includes("R");
      const ops = args.filter((a) => !a.startsWith("-"));
      if (ops.length < 2) return "cp: missing destination operand";
      const [srcArg, dstArg] = ops;
      const src = t.resolve(srcArg);
      const srcNode = t.getNode(src);
      if (!srcNode) return `cp: cannot stat '${srcArg}': No such file or directory`;
      if (srcNode.type === "dir" && !recursive)
        return `cp: -r not specified; omitting directory '${srcArg}'`;
      if (srcNode.type !== "dir" && !t.canRead(src))
        return `cp: cannot open '${srcArg}' for reading: Permission denied`;
      let dst = t.resolve(dstArg);
      const dstNode = t.getNode(dst);
      if (dstNode && dstNode.type === "dir") dst = dst.concat(src[src.length - 1]);
      if (t.pathKey(src) === t.pathKey(dst))
        return `cp: '${srcArg}' and '${dstArg}' are the same file`;
      if (t.pathKey(dst).startsWith(t.pathKey(src) + "/"))
        return `cp: cannot copy '${srcArg}' into itself, '${dstArg}'`;
      if (!t.canModify(dst))
        return `cp: cannot create '${dstArg}': Permission denied`;
      const parent = t.getNode(dst.slice(0, -1));
      if (!parent || parent.type !== "dir")
        return `cp: cannot create '${dstArg}': No such file or directory`;
      const finalDst = t.getNode(dst);
      if (finalDst && finalDst.type === "dir" && srcNode.type !== "dir")
        return `cp: cannot overwrite directory '${dstArg}' with non-directory`;
      t.copyTree(src, dst);
    },
  },

  mv: {
    desc: "Move or rename a file or directory",
    native: true,
    usage: "mv <src> <dst>",
    run(args, ctx) {
      const t = ctx.term;
      const ops = args.filter((a) => !a.startsWith("-"));
      if (ops.length < 2) return "mv: missing destination operand";
      const [srcArg, dstArg] = ops;
      const src = t.resolve(srcArg);
      const srcNode = t.getNode(src);
      if (!srcNode) return `mv: cannot stat '${srcArg}': No such file or directory`;
      let dst = t.resolve(dstArg);
      const dstNode = t.getNode(dst);
      if (dstNode && dstNode.type === "dir") dst = dst.concat(src[src.length - 1]);
      if (t.pathKey(src) === t.pathKey(dst)) return; // no-op
      if (t.pathKey(dst).startsWith(t.pathKey(src) + "/"))
        return `mv: cannot move '${srcArg}' to a subdirectory of itself, '${dstArg}'`;
      if (!t.canWriteDir(src.slice(0, -1)))
        return `mv: cannot move '${srcArg}': Permission denied`;
      if (!t.canModify(dst))
        return `mv: cannot move to '${dstArg}': Permission denied`;
      const parent = t.getNode(dst.slice(0, -1));
      if (!parent || parent.type !== "dir")
        return `mv: cannot move to '${dstArg}': No such file or directory`;
      const finalDst = t.getNode(dst);
      if (finalDst && finalDst.type === "dir" && srcNode.type !== "dir")
        return `mv: cannot overwrite directory '${dstArg}' with non-directory`;
      if (finalDst && finalDst.type !== "dir" && srcNode.type === "dir")
        return `mv: cannot overwrite non-directory '${dstArg}' with directory`;
      t.copyTree(src, dst);
      t.remove(src, { recursive: true });
      if (!t.exists(t.cwd)) t.setCwd(t.home);
    },
  },

  vi: {
    desc: "Edit a file (looks-like-vi)",
    native: true,
    usage: "vi <file>",
    run(args, ctx) {
      const arg = args[0];
      if (!arg) return "usage: vi <file>";
      const segs = ctx.term.resolve(arg);
      const node = ctx.term.getNode(segs);
      if (node && node.type === "dir") return `vi: ${arg}: Is a directory`;
      if (node && node.locked) {
        ctx.term.denied();
        return;
      }
      if (node && node.type === "link") return `vi: ${arg}: cannot edit a link`;
      const name = segs[segs.length - 1] || arg;
      if (!node) {
        if (!ctx.term.canModify(segs))
          return `vi: cannot create '${arg}': Permission denied`;
        const parent = ctx.term.getNode(segs.slice(0, -1));
        if (!parent || parent.type !== "dir")
          return `vi: cannot open '${arg}': No such file or directory`;
      } else if (!ctx.term.canRead(segs)) {
        return `vi: ${arg}: Permission denied`;
      }
      const writable = ctx.term.canModify(segs);
      ctx.term.editor(segs, node ? node.content || "" : "", writable, name);
    },
  },

  vim: {
    desc: "Edit a file (looks-like-vi)",
    native: true,
    usage: "vim <file>",
    run(args, ctx) {
      return TERM.commands.vi.run(args, ctx);
    },
  },

  reset: {
    desc: "Reset the filesystem to its original state",
    native: true,
    run(_args, ctx) {
      ctx.term.resetFs();
      ctx.term.oldpwd = null;
      ctx.term.dirstack = [];
      ctx.term.cwd = ctx.term.home.slice();
      return "Filesystem reset — your created/edited files were cleared.";
    },
  },

  // --- about-me actions ----------------------------------------------------

  resume: {
    desc: "Open my resume",
    run(_args, ctx) {
      ctx.term.openLink(TERM.identity.resumeUrl);
      return "Opening resume...";
    },
  },

  email: {
    desc: "Open an email to me",
    run(_args, ctx) {
      ctx.term.openLink(
        `mailto:${TERM.identity.email}?subject=${encodeURIComponent("Hey Chris 👋")}`
      );
      return `Opening mailto:${TERM.identity.email}...`;
    },
  },

  github: {
    desc: "Open my GitHub",
    run(_args, ctx) {
      ctx.term.openLink(TERM.identity.github);
      return "Opening GitHub...";
    },
  },

  linkedin: {
    desc: "Open my LinkedIn",
    run(_args, ctx) {
      ctx.term.openLink(TERM.identity.linkedin);
      return "Opening LinkedIn...";
    },
  },

  repo: {
    desc: "Open this site's source code",
    run(_args, ctx) {
      ctx.term.openLink(TERM.identity.repoUrl);
      return "Opening repo...";
    },
  },

  social: {
    desc: "List my links",
    run() {
      const i = TERM.identity;
      return `email      ${i.email}\ngithub     ${i.github}\nlinkedin   ${i.linkedin}\n\nType 'email', 'github', or 'linkedin' to open one.`;
    },
  },

  // --- terminal extras -----------------------------------------------------

  neofetch: {
    desc: "Show a system info card",
    run(_args, ctx) {
      const i = TERM.identity;
      const host = ctx.term.host;
      const logo = [
        "       .--.       ",
        "      |o_o |      ",
        "      |:_/ |      ",
        "     //   \\ \\     ",
        "    (|     | )    ",
        "   /'\\_   _/`\\    ",
        "   \\___)=(___/    ",
      ];
      const info = [
        `${i.user}@${host}`,
        "-----------------",
        `Name:    ${i.name}`,
        `OS:      ChrisOS (web build)`,
        `Shell:   chsh 1.0`,
        `Theme:   ${TERM.themes[document.body.dataset.theme] || "Solarized Dark"}`,
        `Editor:  vim (allegedly)`,
        `Uptime:  too long`,
        `Contact: ${i.email}`,
      ];
      const rows = Math.max(logo.length, info.length);
      const out = [];
      for (let r = 0; r < rows; r++) {
        const l = (logo[r] || "").padEnd(20);
        const n = info[r] || "";
        out.push(l + n);
      }
      ctx.printBlock(out.join("\n"));
    },
  },

  theme: {
    desc: "Change color theme",
    usage: "theme [name]",
    run(args, ctx) {
      const names = Object.keys(TERM.themes);
      if (!args.length) {
        const current = document.body.dataset.theme;
        const list = names
          .map((n) => `  ${n === current ? "*" : " "} ${n.padEnd(18)}${TERM.themes[n]}`)
          .join("\n");
        return `Available themes (current marked *):\n\n${list}\n\nUsage: theme <name>`;
      }
      const name = args[0];
      if (!names.includes(name))
        return `theme: unknown theme '${name}'. Run 'theme' to list them.`;
      ctx.term.setTheme(name);
      return `Theme set to ${TERM.themes[name]}.`;
    },
  },

  banner: {
    desc: "Print the banner",
    run(_args, ctx) {
      ctx.printBlock(ctx.term.pickBanner());
    },
  },

  weather: {
    desc: "Show the weather (via wttr.in)",
    usage: "weather [location]",
    async run(args, ctx) {
      const loc = encodeURIComponent(args.join(" "));
      try {
        const res = await fetch(`https://wttr.in/${loc}?ATm`);
        if (!res.ok) return `weather: request failed (${res.status})`;
        ctx.printBlock((await res.text()).trimEnd());
      } catch (e) {
        return "weather: could not reach wttr.in (offline?)";
      }
    },
  },

  // --- easter eggs (hidden) ------------------------------------------------

  sudo: {
    desc: "Execute a command as superuser",
    hidden: true,
    run(args, ctx) {
      // let `sudo rm -rf /` reach the rm gag instead of a generic deny
      if (args[0] === "rm") return TERM.commands.rm.run(args.slice(1), ctx);
      const cmd = args.join(" ") || "su";
      return `${TERM.identity.user} is not in the sudoers file. This incident will be reported.\n(nice try — '${cmd}' denied)`;
    },
  },

  sl: {
    desc: "Steam locomotive (you meant 'ls')",
    hidden: true,
    run(_args, ctx) {
      ctx.term.steamLocomotive();
    },
  },

  hack: {
    desc: "Hack the mainframe",
    usage: "hack [target]",
    hidden: true,
    run(args, ctx) {
      ctx.term.hack(args.join(" "));
    },
  },

  fortune: {
    desc: "Print a random fortune",
    hidden: true,
    run(_args, ctx) {
      const list = TERM.fortunes || [];
      if (!list.length) return "fortune: the cookie is empty.";
      return list[Math.floor(ctx.term.random() * list.length)];
    },
  },

  cowsay: {
    desc: "An ASCII cow says something",
    usage: "cowsay <text>",
    hidden: true,
    run(args) {
      const text = args.join(" ") || "Moo.";
      const width = 40;
      const lines = [];
      let cur = "";
      for (const w of text.split(/\s+/)) {
        if (cur && (cur + " " + w).length > width) {
          lines.push(cur);
          cur = w;
        } else {
          cur = cur ? cur + " " + w : w;
        }
      }
      if (cur) lines.push(cur);
      if (!lines.length) lines.push("");
      const max = Math.max(...lines.map((l) => l.length));
      const top = " " + "_".repeat(max + 2);
      const bottom = " " + "-".repeat(max + 2);
      let body;
      if (lines.length === 1) {
        body = `< ${lines[0]} >`;
      } else {
        body = lines
          .map((l, i) => {
            const left = i === 0 ? "/" : i === lines.length - 1 ? "\\" : "|";
            const right = i === 0 ? "\\" : i === lines.length - 1 ? "/" : "|";
            return `${left} ${l.padEnd(max)} ${right}`;
          })
          .join("\n");
      }
      const cow = [
        "        \\   ^__^",
        "         \\  (oo)\\_______",
        "            (__)\\       )\\/\\",
        "                ||----w |",
        "                ||     ||",
      ].join("\n");
      return `${top}\n${body}\n${bottom}\n${cow}`;
    },
  },

  top: {
    desc: "Display running processes",
    hidden: true,
    run(_args, ctx) {
      const procs = [
        ["1", "guest", "coffee-daemon"],
        ["42", "guest", "existential-dread"],
        ["1337", "root", "definitely-not-mining-crypto"],
        ["2001", "guest", "spinning-up-hopes"],
        ["8086", "guest", "node_modules-indexer"],
        ["9000", "guest", "over-engineering.service"],
        ["404", "guest", "motivation"],
      ];
      const header =
        "top - up 42 days,  4:20,  1 user,  load average: 0.42, 0.69, 1.33";
      const tasks = `Tasks: ${procs.length} total, ${procs.length} running, 0 useful`;
      const cpuLine = "%Cpu(s): caffeine 73.0, productivity 12.0, meetings 15.0";
      const cols = "  PID USER      %CPU %MEM  COMMAND";
      const rows = procs
        .map(([pid, user, cmd]) => {
          const cpu = (ctx.term.random() * 100).toFixed(1).padStart(5);
          const mem = (ctx.term.random() * 30).toFixed(1).padStart(5);
          return `${pid.padStart(5)} ${user.padEnd(8)} ${cpu} ${mem}  ${cmd}`;
        })
        .join("\n");
      return `${header}\n${tasks}\n${cpuLine}\n\n${cols}\n${rows}\n\n(press q... oh wait, it already exited)`;
    },
  },

  htop: {
    desc: "Display running processes (prettier)",
    hidden: true,
    run(args, ctx) {
      return TERM.commands.top.run(args, ctx);
    },
  },

  crt: {
    desc: "Toggle CRT scanline mode (also via the Konami code)",
    hidden: true,
    run(_args, ctx) {
      ctx.term.toggleCRT();
    },
  },

  matrix: {
    desc: "Follow the white rabbit",
    hidden: true,
    run(_args, ctx) {
      ctx.term.matrix();
    },
  },

  fsn: {
    desc: "3D filesystem navigator (Jurassic Park)",
    usage: "fsn [path]",
    run(args, ctx) {
      const segs = ctx.term.resolve(args[0] || ".");
      const node = ctx.term.getNode(segs);
      if (!node) return `fsn: ${args[0]}: No such file or directory`;
      if (node.type !== "dir") return `fsn: ${args[0]}: Not a directory`;
      ctx.print("It's a Unix system! I know this!");
      ctx.term.fsn(segs);
    },
  },
};
