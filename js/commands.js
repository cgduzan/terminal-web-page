/**
 * commands.js — the command registry.
 *
 * Each command: { desc, usage?, hidden?, run(args, ctx) }
 *   - desc    one-line description (shown in `help` and `man`)
 *   - usage   optional usage string (shown in `man`)
 *   - hidden  excluded from `help`/autocomplete (easter eggs)
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

TERM.commands = {
  help: {
    desc: "List available commands",
    run() {
      const names = Object.entries(TERM.commands)
        .filter(([, c]) => !c.hidden)
        .map(([name]) => name)
        .sort();
      const rows = names
        .map((n) => `  ${n.padEnd(12)}${TERM.commands[n].desc}`)
        .join("\n");
      return `Available commands:\n\n${rows}\n\nTip: 'man <command>' for details. Tab completes. ↑/↓ for history.\nFiles you create or edit are saved in this browser only — 'reset' clears them.`;
    },
  },

  man: {
    desc: "Show the manual for a command",
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
    run(_args, ctx) {
      ctx.term.clearScreen();
    },
  },

  echo: {
    desc: "Print text back",
    usage: "echo <text>",
    run(args) {
      return args.join(" ");
    },
  },

  date: {
    desc: "Show the current date and time",
    run() {
      return new Date().toString();
    },
  },

  whoami: {
    desc: "Print the current user",
    run() {
      return TERM.identity.user;
    },
  },

  hostname: {
    desc: "Print the hostname",
    run(_args, ctx) {
      return ctx.term.host;
    },
  },

  history: {
    desc: "Show command history",
    run(_args, ctx) {
      const h = ctx.term.history;
      if (!h.length) return "No history yet.";
      return h.map((c, i) => `  ${String(i + 1).padStart(3)}  ${c}`).join("\n");
    },
  },

  // --- filesystem ----------------------------------------------------------

  pwd: {
    desc: "Print the working directory",
    run(_args, ctx) {
      return ctx.term.pwdString();
    },
  },

  ls: {
    desc: "List directory contents",
    usage: "ls [-a] [path]",
    run(args, ctx) {
      const showHidden = args.includes("-a");
      const target = args.find((a) => !a.startsWith("-"));
      const path = ctx.term.resolve(target || ".");
      const node = path && ctx.term.node(path);
      if (!node) return `ls: cannot access '${target}': No such file or directory`;
      if (node.type !== "dir") return ctx.esc(target); // listing a file prints its name
      const entries = Object.entries(ctx.term.listDir(path))
        .filter(([name]) => showHidden || !name.startsWith("."))
        .sort(([a], [b]) => a.localeCompare(b));
      if (!entries.length) {
        ctx.print("");
        return;
      }
      const html = entries
        .map(([name, child]) => {
          if (child.type === "dir")
            return `<span class="fs-dir">${ctx.esc(name)}/</span>`;
          if (child.type === "link")
            return `<span class="fs-link">${ctx.esc(name)}</span>`;
          if (child.locked)
            return `<span class="fs-locked">${ctx.esc(name)}</span>`;
          return `<span class="fs-file">${ctx.esc(name)}</span>`;
        })
        .join("   ");
      ctx.printHTML(html);
    },
  },

  cd: {
    desc: "Change directory",
    usage: "cd [path]",
    run(args, ctx) {
      const target = args[0] || "~";
      const path = ctx.term.resolve(target);
      const node = path && ctx.term.node(path);
      if (!node) return `cd: no such file or directory: ${target}`;
      if (node.type !== "dir") return `cd: not a directory: ${target}`;
      ctx.term.cwd = path;
    },
  },

  cat: {
    desc: "Print a file's contents",
    usage: "cat <file>",
    run(args, ctx) {
      if (!args.length) return "cat: missing file operand. Try 'cat about.txt'.";
      const out = [];
      for (const arg of args) {
        const path = ctx.term.resolve(arg);
        const node = path && ctx.term.node(path);
        if (!node) {
          out.push(`cat: ${arg}: No such file or directory`);
          continue;
        }
        if (node.type === "dir") {
          out.push(`cat: ${arg}: Is a directory`);
          continue;
        }
        if (node.locked) {
          ctx.term.denied();
          continue;
        }
        if (node.type === "link") {
          ctx.term.openLink(node.url);
          out.push(node.content || `Opening ${node.url}...`);
          continue;
        }
        out.push(node.content);
      }
      return out.join("\n");
    },
  },

  tree: {
    desc: "Show the directory tree",
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

  touch: {
    desc: "Create an empty file",
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
        if (!ctx.term.canWrite(segs)) {
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
        if (!ctx.term.canWrite(segs)) {
          out.push(`mkdir: cannot create directory '${arg}': Permission denied`);
          continue;
        }
        const parent = ctx.term.getNode(segs.slice(0, -1));
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
    usage: "rm [-r] <path>",
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
        if (!ctx.term.canWrite(segs)) {
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
      if (!ctx.term.exists(ctx.term.cwd)) ctx.term.cwd = ctx.term.home.slice();
      return out.join("\n");
    },
  },

  vi: {
    desc: "Edit a file (looks-like-vi)",
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
        if (!ctx.term.canWrite(segs))
          return `vi: cannot create '${arg}': Permission denied`;
        const parent = ctx.term.getNode(segs.slice(0, -1));
        if (!parent || parent.type !== "dir")
          return `vi: cannot open '${arg}': No such file or directory`;
      }
      ctx.term.editor(segs, node ? node.content || "" : "", ctx.term.canWrite(segs), name);
    },
  },

  vim: {
    desc: "Edit a file (looks-like-vi)",
    usage: "vim <file>",
    run(args, ctx) {
      return TERM.commands.vi.run(args, ctx);
    },
  },

  reset: {
    desc: "Reset the filesystem to its original state",
    run(_args, ctx) {
      ctx.term.resetFs();
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
};
