# assets

Drop the Jurassic Park easter-egg clip here:

- `nedry.gif` — the "ah ah ah, you didn't say the magic word" finger-wag
- `nedry.mp3` — a matching short audio clip (a few seconds)

The file names/paths are configured in `js/config.js` under `TERM.eggs`
(`jurassicParkGif` / `jurassicParkAudio`). You can point those at any local
file or a URL instead.

If a file is missing, the egg degrades gracefully: it still prints the line,
shakes the screen, and plays a short beep — no broken image, no error.

Note: that clip is copyrighted (Universal). Supplying it for a personal
easter egg is your call; it isn't checked into this repo.
