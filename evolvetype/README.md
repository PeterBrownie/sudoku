# evolveType

Animated SVG typography, evolved by artificial selection. Type a word, pick a starting style, and a 3×3 grid shows the parent in the centre surrounded by eight mutations. Select one, evolve again, repeat.

Same interaction model as [evolveSVG](../evolvesvg), applied to kinetic type instead of generative patterns.

## How it works

Text is converted to **glyph outlines** with opentype.js rather than rendered as `<text>`, so exports are portable to machines without the font and individual letterforms can be cut apart. That means this project owns its own typesetting: kerning, line-breaking, alignment and shrink-to-fit are all computed from font metrics in `src/typeset.js`.

### The one contract

`genomeToSVG(genome, text, opts)` in `src/render.js` is a pure function with two modes:

| Mode | Output | Used by |
|---|---|---|
| `animated` | CSS `@keyframes` embedded in the SVG; it animates itself | Live grid, SVG export |
| `frame` | Every easing curve evaluated in JS at time `t`, baked to static attributes | Scrubbing, PNG poster, frame sequence |

Both read the same timeline functions in `src/anim.js`. **If they diverge, exported frames stop matching the preview** — that invariant is the reason the timeline maths lives in one module rather than inside the renderer.

Scrubbing deliberately re-bakes in `frame` mode instead of nudging `animation-delay`, because repositioning a running CSS animation via its delay behaves inconsistently across browsers. It also means what you scrub to is exactly what you export.

### Modules

```
src/genome.js    schema, defaults, randomization, colour helpers
src/mutate.js    parameter drift + structural jumps, driven by 4 sliders
src/fonts.js     manifest loading, opentype.js parsing, face cache
src/typeset.js   layout: kerning, wrapping, alignment, shrink-to-fit
src/split.js     cuts a layout into independently animated elements
src/anim.js      easing, per-element timing, motion presets, chromatic offsets
src/effects.js   filter chains, background, overlays, masks, decoration
src/render.js    genomeToSVG — the single builder
src/export.js    animated SVG, poster PNG, PNG sequence + ZIP writer
src/app.js       grid, evolution loop, transport, export wiring
```

### Split modes

How a word is cut into separately animated pieces:

| Mode | Cuts |
|---|---|
| `bands-h` / `bands-v` / `diagonal` | The whole word into slats — the A24 look |
| `glyph-bands` / `glyph-bands-v` | **Each letter independently**, so parts of one letterform arrive separately |
| `glyph` / `word` / `line` | Whole units |
| `contour` | Disjoint solid parts — dot vs. stem of an `i`, the three parts of `%` |
| `none` | One piece |

`contour` groups each outer contour with the counters it encloses, rather than emitting raw sub-paths. A counter is only a hole because it shares a path with its outer contour — the nonzero fill rule needs the two to have opposite winding. Split them into separate `<path>` elements and every counter becomes its own filled shape drawn on top of the letter, so `O`, `B`, `8`, `e` and `a` come out solid. See `splitGlyphParts` in `src/typeset.js`.

`split.clipMode` decides whether the clip sits inside or outside the motion transform:

- `travel` — the band carries its slice of the glyph and the word **reassembles**
- `fixed` — the text **slides through** stationary slats and is revealed

**On stroke separation:** outline fonts cannot give true per-stroke animation. The stem and crossbar of a `t` are one closed contour (in Archivo Black, `t` is a single contour; so are `T` and `H`). `contour` mode therefore separates counters and dots but never a crossbar. `glyph-bands` slices each glyph geometrically instead, which gets the effect approximately. True stroke decomposition would need a single-line plotter font, where each glyph is a list of polylines.

### Flicker

`motion.flicker` (0–1) replaces the linear opacity ramp with a seeded envelope: a dim pre-glow, a few uneven blinks, then a settle — a light striking rather than an object arriving. It's a free-standing modifier, so evolution can drop a blink onto any entrance; the `powerOn` preset is simply zero travel plus a guaranteed minimum flicker.

Because the envelope is authored against *raw* time rather than eased progress, its blink rhythm survives whatever easing the motion uses. CSS interpolates linearly between keyframe stops and `sampleEnvelope` interpolates linearly too, which is what keeps the two render modes in agreement.

## Secondary block

An optional second text block, typeset through the same pipeline as the title. Both blocks are laid out **as a unit** — stacked with a gap, with the pair centred on the type anchor — so neither drifts off-frame as the other resizes. It carries its own font, size, tracking, case, colour slot, split mode and entrance delay, and every one of those is mutable.

Implementation note: each block is typeset around the same anchor and then offset by a translate on its wrapper, rather than re-typeset at computed baselines. That keeps every glyph path, clip rect and motion origin in a single coordinate space, so one translate moves the geometry, its clips and its animation origins together.

## Composition

Two rules keep generated frames from looking accidental:

- **Rotation is never continuous.** An arbitrary 1.4° tilt always reads as a mistake, so rotation is either level or one of `{±3°, ±6°}`, with a strong pull back to level each generation. Across 400 lineages at 12 generations deep, 96.7% end perfectly level.
- **Decoration aligns to the type.** Rules span the text block's own measure rather than a fixed fraction of the canvas, the frame and ticks share one margin (`DECOR_MARGIN`), and the typesetter widens its own margin to clear them when either is present. Block positions also snap onto canonical placements (centre, thirds, quarters) when they drift close to one.

## Adding fonts

Drop a font in `fonts/` and add an entry to `fonts/manifest.json`. No code changes — the mutation engine picks up whatever the manifest lists.

- **Must be `.ttf`, `.otf` or `.woff`.** opentype.js cannot read `.woff2`.
- **Each weight is a separate file.** opentype.js reads a font's default instance and will not interpolate a variable font's weight axis. Instance variable fonts first: `fonttools varLib.instancer Font-VF.ttf wght=700 -o Font-Bold.ttf`.
- Subsetting to Latin keeps things small — the nine bundled faces total ~280KB:
  ```
  pyftsubset Font.ttf --unicodes="U+0020-007E,U+00A0-00FF" \
      --layout-features='kern,liga,calt' --no-hinting --output-file=Font.ttf
  ```
  Keep `kern` — the typesetter reads kerning pairs from it.

Weight is also a *continuous* axis independent of the files present: `type.weightBoost` strokes each outline in its own fill colour to thicken it synthetically.

## Adding presets

Append to `presets/presets.json`. Each entry is a **partial** genome merged over the defaults by `normalizeGenome`, so only state what differs.

## Exports

- **Animated SVG** — self-contained, CSS-animated, with the genome embedded under `<evolvetype:state>`. Re-open it in the tool (drag and drop) to restore the whole style and keep evolving.
- **Poster PNG** — a single baked frame at the current scrub position.
- **PNG sequence (ZIP)** — one full loop as numbered frames at 24/30/60 fps, plus a `sequence.txt` with the frame count and duration. Stored (uncompressed) ZIP, since PNGs are already deflated.

Because paths aren't readable as text, exports carry the original string in `<title>` for accessibility.

## Credits

Fonts are SIL OFL 1.1: Inter, Archivo Black, Bebas Neue, Playfair Display, Poppins, Space Mono. [opentype.js](https://github.com/opentypejs/opentype.js) is MIT, vendored in `vendor/`.
