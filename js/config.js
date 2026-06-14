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
// The home directory (~) is /home/guest. Edit the content strings below to
// personalize the site — anything bracketed [like this] is a placeholder.

const id = TERM.identity;

TERM.fs = {
  type: "dir",
  children: {
    home: {
      type: "dir",
      children: {
        guest: {
          type: "dir",
          children: {
            "about.txt": {
              type: "file",
              content: `Hi, I'm ${id.name}.

Software engineer — I build things for the web. Currently at Eluve,
working on AI-powered clinical documentation. [confirm/edit this line]

This whole site is a terminal. A few ways to explore:
  ls              list what's here
  cat about.txt   read a file (you're reading one now)
  cd projects     change directory, then 'ls' again
  tree            see everything at once
  vi notes.txt    create / edit a file (saved in your browser)
  help            full command list

Not a terminal person? ${id.standardSite ? "There's a normal site at " + id.standardSite + "." : "A normal version of this site is coming soon."}`,
            },
            "skills.txt": {
              type: "file",
              content: `SKILLS
======

Languages    JavaScript, TypeScript, [add yours]
Frontend     React, HTML, CSS, [add yours]
Backend      Node, [add yours]
Data / infra GraphQL, [add yours]
Tools        Git, [add yours]

[Edit js/config.js -> fs -> skills.txt to make this yours.]`,
            },
            "contact.txt": {
              type: "file",
              content: `CONTACT
=======

email      ${id.email}
github     ${id.github}
linkedin   ${id.linkedin}

Shortcuts: type 'email', 'github', or 'linkedin' to open directly.`,
            },
            "now.txt": {
              type: "file",
              content: `NOW
===

What I'm focused on right now (a /now page, nownownow.com style):

  - [What you're working on]
  - [What you're learning]
  - [Anything else current]

Last updated: [date]. Edit in js/config.js.`,
            },
            "resume.pdf": {
              type: "link",
              url: id.resumeUrl,
              content: "Opening resume...",
            },
            experience: {
              type: "dir",
              children: {
                "eluve.txt": {
                  type: "file",
                  content: `Eluve — Software Engineer
[start date] – present

  - [What you build / own]
  - [Impact, scale, a result you're proud of]
  - [Stack you work in]

[Edit in js/config.js.]`,
                },
                "previous.txt": {
                  type: "file",
                  content: `[Previous Company] — [Title]
[dates]

  - [What you did]
  - [Add more roles as files in this directory.]`,
                },
              },
            },
            projects: {
              type: "dir",
              children: {
                "terminal-web-page.txt": {
                  type: "file",
                  content: `terminal-web-page
=================

The site you're looking at. A static, dependency-free web page that
behaves like a terminal — fake filesystem, command history, themes,
and a few easter eggs.

  Stack   Vanilla JS, CSS (Solarized Dark)
  Source  ${id.repoUrl}

Type 'repo' to open the source.`,
                },
                "ideas.txt": {
                  type: "file",
                  content: `[Add a project per file in this directory.]

Each one shows up in 'ls' and is readable with 'cat'. Keep them short —
a sentence on what it is, the stack, and a link.`,
                },
              },
            },
            ".secret": {
              type: "file",
              locked: true,
              content: "If you're reading this, the lock failed.",
            },
          },
        },
      },
    },
  },
};

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
