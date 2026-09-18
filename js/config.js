/**
 * config.js — identity, fake filesystem, and themes.
 * This is the file to edit when personalizing the site. The engine
 * (terminal.js) and command handlers (commands.js) read everything from
 * the global TERM object defined here.
 *
 * Loaded first (see index.html). Classic script, no modules, so it works
 * over file:// as well as http://.
 */

const TERM = {};

// --- IDENTITY ---------------------------------------------------------------

TERM.identity = {
  user: "guest",
  // Leave empty to use the page's real hostname (localhost in dev,
  // your domain in production). Set a value to pin it everywhere.
  host: "",
  name: "Chris Duzan",
  // Action commands open these. Edit freely.
  email: "cgduzan@gmail.com",
  github: "https://github.com/cgduzan",
  linkedin: "https://www.linkedin.com/in/christopher-duzan/",
  resumeUrl: "https://standardresume.co/r/QJ_hCYRLyUAn3zHJmXCYV",
  repoUrl: "https://github.com/cgduzan/terminal-web-page",
  // Optional: link to a plain (non-terminal) version of the site.
  standardSite: "", // e.g. "https://chrisduzan.com"
};

// --- BANNER -----------------------------------------------------------------

TERM.banner = `
█████  █   █  ████   ███  █████       ████   █   █  █████  █████  █   █
█      █   █  █   █   █   █           █   █  █   █     █   █   █  ██  █
█      █████  ████    █   █████       █   █  █   █    █    █████  █ █ █
█      █   █  █  █    █       █       █   █  █   █   █     █   █  █  ██
█████  █   █  █   █  ███  █████       ████   █████  █████  █   █  █   █

Welcome. Type 'help' for commands, or 'ls' to look around.`;

// Compact banner for narrow screens (phones). The full banner is ~70 cols and
// only the left half would show. Keep this under ~30 cols.
TERM.bannerNarrow = `
┌────────────────────────┐
│   C H R I S  D U Z A N │
└────────────────────────┘

Type 'help' or 'ls'.`;

// --- FAKE FILESYSTEM --------------------------------------------------------
// Tree of nodes. A node is one of:
//   { type: "dir",  children: { name: node, ... } }
//   { type: "file", content: "..." }
//   { type: "link", url: "...", content: "Opening ..." }   // cat opens the URL
//   add `locked: true` to a file for an easter-egg "access denied".
//
// Layout mirrors a small Unix root: /bin /boot /dev /etc /home /lib /media
// /mnt /opt /proc /root /sbin /tmp /usr /var. The home directory (~) is
// /home/guest — edit those content strings to personalize the site.
// Anything bracketed [like this] is a placeholder.

const id = TERM.identity;

// Tiny helpers so the system dirs stay readable.
const dir = (children = {}) => ({ type: "dir", children });
const file = (content) => ({ type: "file", content });
const bin = (name) =>
  file(
    `${name}: ELF 64-bit LSB executable, ChrisOS/web\n` +
      `This stub cannot run in a browser. Type '${name}' at the prompt instead.`
  );

TERM.fs = dir({
  bin: dir({
    bash: bin("bash"),
    cat: bin("cat"),
    cd: bin("cd"),
    chmod: bin("chmod"),
    clear: bin("clear"),
    cp: bin("cp"),
    date: bin("date"),
    echo: bin("echo"),
    ls: bin("ls"),
    mkdir: bin("mkdir"),
    mv: bin("mv"),
    pwd: bin("pwd"),
    rm: bin("rm"),
    sh: bin("sh"),
    touch: bin("touch"),
    whoami: bin("whoami"),
  }),
  boot: dir({
    "vmlinuz-6.1.0-chrisos": file(
      "Linux kernel image (ChrisOS web build)\n" +
        "Not actually bootable. You're already in the browser."
    ),
    "initrd.img": file("Initial ramdisk. Mostly vibes."),
  }),
  dev: dir({
    null: file(""),
    zero: file("(infinite zeros omitted for your terminal's sake)\n"),
    tty: file("(you are here)\n"),
    random: file("4\n"), // chosen by fair dice roll
    urandom: file("4\n"),
  }),
  etc: dir({
    hostname: file("chrisos"),
    hosts: file(
      "127.0.0.1\tlocalhost\n" +
        "::1\t\tlocalhost\n" +
        "127.0.1.1\tchrisos"
    ),
    passwd: file(
      "root:x:0:0:root:/root:/bin/bash\n" +
        "guest:x:1000:1000:Guest User:/home/guest:/bin/bash\n" +
        "nobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin"
    ),
    group: file(
      "root:x:0:\n" +
        "guest:x:1000:\n" +
        "nogroup:x:65534:"
    ),
    "os-release": file(
      'NAME="ChrisOS"\n' +
        'PRETTY_NAME="ChrisOS (web build)"\n' +
        'ID=chrisos\n' +
        'VERSION_ID="1.0"\n' +
        "HOME_URL=\"" + id.repoUrl + "\""
    ),
    issue: file("ChrisOS 1.0 \\n \\l\n"),
    motd: file(
      "Welcome to ChrisOS.\n" +
        "Type 'help' for commands, or 'cd ~' to head home.\n"
    ),
    shells: file("/bin/sh\n/bin/bash\n"),
    timezone: file("America/New_York\n"),
  }),
  home: dir({
    guest: dir({
      "about.txt": file(
        `Hi, I'm ${id.name}.

Software engineer — I build things for the web. Currently at Eluve,
working on AI-powered clinical documentation. [confirm/edit this line]

This whole site is a terminal. A few ways to explore:
  ls              list what's here
  cat about.txt   read a file (you're reading one now)
  cd projects     change directory, then 'ls' again
  tree            see everything at once
  fsn             3D filesystem navigator (Jurassic Park vibes)
  vi notes.txt    create / edit a file (saved in your browser)
  help            full command list

Not a terminal person? ${id.standardSite ? "There's a normal site at " + id.standardSite + "." : "A normal version of this site is coming soon."}`
      ),
      "skills.txt": file(
        `SKILLS
======

Languages    JavaScript, TypeScript, [add yours]
Frontend     React, HTML, CSS, [add yours]
Backend      Node, [add yours]
Data / infra GraphQL, [add yours]
Tools        Git, [add yours]

[Edit js/config.js -> fs -> skills.txt to make this yours.]`
      ),
      "contact.txt": file(
        `CONTACT
=======

email      ${id.email}
github     ${id.github}
linkedin   ${id.linkedin}

Shortcuts: type 'email', 'github', or 'linkedin' to open directly.`
      ),
      "now.txt": file(
        `NOW
===

What I'm focused on right now (a /now page, nownownow.com style):

  - [What you're working on]
  - [What you're learning]
  - [Anything else current]

Last updated: [date]. Edit in js/config.js.`
      ),
      "resume.pdf": {
        type: "link",
        url: id.resumeUrl,
        content: "Opening resume...",
      },
      experience: dir({
        "eluve.txt": file(
          `Eluve — Software Engineer
[start date] – present

  - [What you build / own]
  - [Impact, scale, a result you're proud of]
  - [Stack you work in]

[Edit in js/config.js.]`
        ),
        "previous.txt": file(
          `[Previous Company] — [Title]
[dates]

  - [What you did]
  - [Add more roles as files in this directory.]`
        ),
      }),
      projects: dir({
        "terminal-web-page.txt": file(
          `terminal-web-page
=================

The site you're looking at. A static, dependency-free web page that
behaves like a terminal — fake filesystem, command history, themes,
and a few easter eggs.

  Stack   Vanilla JS, CSS (Solarized Dark)
  Source  ${id.repoUrl}

Type 'repo' to open the source.`
        ),
        "ideas.txt": file(
          `[Add a project per file in this directory.]

Each one shows up in 'ls' and is readable with 'cat'. Keep them short —
a sentence on what it is, the stack, and a link.`
        ),
      }),
      ".bashrc": file(
        "# ~/.bashrc — sourced by imaginary login shells\n" +
          "alias ll='ls -a'\n" +
          "alias ..='cd ..'\n" +
          "export EDITOR=vim\n"
      ),
      ".profile": file(
        "# ~/.profile\n" +
          "export PATH=/usr/local/bin:/usr/bin:/bin\n" +
          "export HOME=/home/guest\n"
      ),
      ".secret": {
        type: "file",
        locked: true,
        content: "If you're reading this, the lock failed.",
      },
    }),
  }),
  lib: dir({
    "libc.so.6": file("GNU C Library (ChrisOS stub). Not loadable here."),
    modules: dir({}),
  }),
  media: dir({}),
  mnt: dir({}),
  opt: dir({}),
  proc: dir({
    version: file(
      "Linux version 6.1.0-chrisos (guest@chrisos) " +
        "(gcc version 13.2.0) #1 SMP PREEMPT_DYNAMIC ChrisOS web\n"
    ),
    cpuinfo: file(
      "processor\t: 0\n" +
        "vendor_id\t: GenuineBrowser\n" +
        "model name\t: JavaScript V8 / whatever-your-browser-runs\n" +
        "cpu MHz\t\t: plenty\n" +
        "cache size\t: enough\n"
    ),
    meminfo: file(
      "MemTotal:        8192000 kB\n" +
        "MemFree:         4096000 kB\n" +
        "MemAvailable:    6144000 kB\n" +
        "SwapTotal:             0 kB\n"
    ),
    uptime: file("1337.42 42.00\n"),
    loadavg: file("0.42 0.36 0.30 1/128 42\n"),
    cmdline: file("BOOT_IMAGE=/boot/vmlinuz-6.1.0-chrisos root=/dev/web ro quiet\n"),
  }),
  root: dir({
    ".bash_history": file("sudo make me a sandwich\n"),
  }),
  sbin: dir({
    reboot: bin("reboot"),
    shutdown: bin("shutdown"),
    ifconfig: bin("ifconfig"),
    mount: bin("mount"),
  }),
  tmp: dir({
    ".keep": file(""),
  }),
  usr: dir({
    bin: dir({
      env: bin("env"),
      fortune: bin("fortune"),
      neofetch: bin("neofetch"),
      tree: bin("tree"),
      vim: bin("vim"),
      which: bin("which"),
    }),
    local: dir({
      bin: dir({}),
      share: dir({}),
    }),
    share: dir({
      man: dir({
        "man1": dir({}),
      }),
      misc: dir({
        "ascii": file(
          "American Standard Code for Information Interchange\n" +
            "Still the lingua franca of terminals.\n"
        ),
      }),
    }),
    sbin: dir({
      nologin: bin("nologin"),
    }),
  }),
  var: dir({
    log: dir({
      syslog: file(
        "Sep 17 23:09:01 chrisos kernel: Booting ChrisOS (web build)\n" +
          "Sep 17 23:09:01 chrisos systemd[1]: Started Terminal Session.\n" +
          "Sep 17 23:09:02 chrisos login[1]: guest logged in on tty1\n"
      ),
      "auth.log": file(
        "Sep 17 23:09:02 chrisos sudo: guest : TTY=tty1 ; USER=root ; COMMAND=/bin/false\n" +
          "Sep 17 23:09:02 chrisos sudo: pam_unix(sudo:auth): authentication failure\n"
      ),
    }),
    tmp: dir({}),
    cache: dir({}),
  }),
});

// --- THEMES -----------------------------------------------------------------
// Each theme maps to CSS custom properties on <body data-theme="...">.
// Solarized Dark is the default. Add your own here and they appear in `theme`.

TERM.themes = {
  "solarized-dark": "Solarized Dark (default)",
  "solarized-light": "Solarized Light",
  dracula: "Dracula",
  gruvbox: "Gruvbox Dark",
};
TERM.defaultTheme = "solarized-dark";

// --- EASTER EGGS ------------------------------------------------------------
// The locked `.secret` file plays the Jurassic Park "ah ah ah" bit.
// Drop your own clip into the assets/ folder (or point these at any URL).
// Leave a value empty ("") to fall back to text + screen-shake + a beep.

TERM.eggs = {
  jurassicParkGif: "assets/nedry.gif",
  jurassicParkAudio: "assets/nedry.mp3",
};

// --- FORTUNES ---------------------------------------------------------------
// One-liners for the `fortune` command. Write your own — keep them original
// (no copyrighted quotes). Add as many as you like.

TERM.fortunes = [
  "There is no place like 127.0.0.1.",
  "Real programmers count from 0.",
  "You will write a bug today. You will fix it tomorrow. The day after, you will reintroduce it.",
  "A good commit message is a love letter to your future self.",
  "\"It works on my machine\" is not a deployment strategy.",
  "You are in a maze of twisty little dependencies, all alike.",
  "The best code is the code you never had to write.",
  "Today's forecast: 100% chance of merge conflicts.",
  "Premature optimization is the root of a fun afternoon.",
  "git push --force is a personality, not a command.",
  "Your tests pass. Be suspicious.",
  "Caffeine: the original package manager for humans.",
  "The cake is a lie, but the stack trace never is.",
  "rm -rf is forever. This filesystem is not.",
  "Weeks of coding can save you hours of planning.",
];
