# terminal-web-page

A personal site that behaves like a terminal. Static, zero dependencies, no
build step — just HTML, CSS, and vanilla JS. Solarized Dark by default.

Visitors explore a fake filesystem (`ls`, `cd`, `cat`, `tree`), run terminal
commands (`neofetch`, `man`, `history`, `theme`, `weather`), and trip a few
easter eggs. Content about me lives as files in the fake filesystem.

## Run it

It must be served over HTTP (opening `index.html` as a `file://` URL breaks
some browsers). From the repo root:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Layout

```
index.html        markup shell + script tags
styles.css        themes (CSS vars per data-theme), block cursor, layout
js/config.js      ← EDIT THIS: identity, fake filesystem content, themes
js/commands.js    command registry (one entry per command)
js/terminal.js    engine: boot, input, cursor, history, fs nav, autocomplete
```

## Making it yours

Almost everything you'll want to change is in **`js/config.js`**:

- `TERM.identity` — name, email, GitHub, LinkedIn, resume URL, repo URL, and
  an optional `standardSite` link.
- `TERM.fs` — the fake filesystem. Content files (`about.txt`, `skills.txt`,
  `now.txt`, `contact.txt`, `experience/*`, `projects/*`) hold the prose
  visitors read with `cat`. Anything in `[brackets]` is a placeholder to fill.
- `TERM.banner` — the ASCII name banner.
- `TERM.themes` — add a theme name here, then add a matching
  `[data-theme="name"]` block of CSS variables in `styles.css`.

To add a command, add an entry to `TERM.commands` in `js/commands.js`. It shows
up in `help`, `man`, and Tab autocomplete automatically. Two opt-out flags:
`hidden: true` keeps it out of `help` and autocomplete (easter eggs), and
`native: true` keeps it out of `help` only — standard shell builtins (`ls`,
`cd`, `vi`, …) still run and autocomplete, but `help` stays focused on the
about-me commands.

## Features

- Full boot animation on first visit; quiet "last login" on return visits.
- Fake filesystem with `ls -a`, `cd`, `cat`, `tree`, relative/`~`/absolute paths.
- Mutable filesystem: `touch`, `mkdir`, `rm`, `cp`, `mv`, output redirection
  (`>` / `>>`), and a real `vi`/`vim` editor. Edits persist per-browser
  (localStorage overlay); `reset` restores the original tree.
- Command history (persisted), ↑/↓ recall, Tab autocomplete, Ctrl+C / Ctrl+L.
- Custom block cursor.
- Theme switcher (`theme`), persisted to localStorage.
- Deep links: `?cmd=neofetch` runs a command on load (and skips the intro).
- Easter eggs: `sudo`, `sl`, `cowsay`, a locked `.secret`, and `matrix`.
- Respects `prefers-reduced-motion`.
