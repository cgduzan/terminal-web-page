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
      return `Available commands:\n\n${rows}\n\nTip: 'man <command>' for details. Tab completes. ↑/↓ for history.`;
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
      const entries = Object.entries(node.children)
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
      const walk = (n, prefix) => {
        if (n.type !== "dir") return;
        const entries = Object.entries(n.children)
          .filter(([name]) => !name.startsWith("."))
          .sort(([a], [b]) => a.localeCompare(b));
        entries.forEach(([name, child], i) => {
          const last = i === entries.length - 1;
          const branch = last ? "└── " : "├── ";
          const suffix = child.type === "dir" ? "/" : "";
          lines.push(prefix + branch + name + suffix);
          walk(child, prefix + (last ? "    " : "│   "));
        });
      };
      walk(node, "");
      return lines.join("\n");
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
      return out.join("\n");
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
    run() {
      return TERM.banner;
    },
  },

  weather: {
    desc: "Show the weather (via wttr.in)",
    usage: "weather [location]",
    async run(args) {
      const loc = encodeURIComponent(args.join(" "));
      try {
        const res = await fetch(`https://wttr.in/${loc}?ATm`);
        if (!res.ok) return `weather: request failed (${res.status})`;
        return (await res.text()).trimEnd();
      } catch (e) {
        return "weather: could not reach wttr.in (offline?)";
      }
    },
  },

  // --- easter eggs (hidden) ------------------------------------------------

  sudo: {
    desc: "Execute a command as superuser",
    hidden: true,
    run(args) {
      const cmd = args.join(" ") || "su";
      return `${TERM.identity.user} is not in the sudoers file. This incident will be reported.\n(nice try — '${cmd}' denied)`;
    },
  },

  vim: {
    desc: "Open vim",
    hidden: true,
    run() {
      return "Entering vim... just kidding. You're trapped forever now.\n(try :q — it won't work. try :q! — also no. welcome home.)";
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
