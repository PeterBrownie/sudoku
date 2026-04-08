# peterbrown.space

A collection of puzzle games and generative art tools, built for personal use, mostly vibe-coded.
Live at **[peterbrown.space](https://peterbrown.space)**

---

## Projects

### evolveSVG

A generative SVG art tool built around artificial selection. A 3×3 grid displays pattern variations; select one to make it the parent, then evolve the next generation from it. Great for generating free high quality background images.

- No licensing requirements for generated images
- Export as SVG or PNG at presets up to 16K; custom pixel dimensions via Advanced Options
- Aspect ratio control for the canvas viewport
- Mutation system with tunable parameters: mutation count, parameter range, structural change rate, max layers
- Shape types: circles, ellipses, rects, polygons, paths, and tiling patterns (dots, stripes, crosshatch, hexgrid, waves, zigzag)
- Blend modes: normal, multiply, screen, overlay, color-dodge, difference, hard-light
- SVG filter effects: feTurbulence displacement, blur, color shift, masking, morphology, diffuse lighting, channel curves, convolution
- Expandable view with zoom/pan and multi-tier LOD rendering (up to Detail of Death mode)
- Animation editor: keyframe-based SVG animation with per-layer parameter controls, preview, and export
- Background animation presets (loaded from SVG templates)
- Bookmarking with optional folder destination, SVG load/paste, copy to clipboard
- Layer panel for reordering, customizing, and managing individual layers

### StoryboundAI

A browser-based interactive fiction RPG powered by a pipeline of specialized AI agents. Create a character, drop into a living world, and take actions that drive a branching narrative. With no backend server, all API requests go directly from your browser to your chosen provider.

- Multi-agent pipeline: ~15 dedicated AI agents handle narration, world state, inventory, objectives, NPC behavior, and scene illustration independently
- NPC opinion profiles with five tracked dimensions (overall, familiarity, trust, loyalty, touch_comfort), updated after every interaction
- Characters evolve: abilities, limitations, and flaws can change based on story events
- Objectives with hidden AI context that guides NPC behavior toward helping or hindering you
- Persistent inventory tracked and recomputed by the AI after every relevant action
- Rolling story log summarization to preserve context over long sessions
- Scene illustration via image generation, with AI-proposed framing options
- Suggested actions each turn based on character abilities, inventory, and active objectives
- Full import/export of characters, story history, and settings as JSON
- Supports multiple API providers; key stored locally, never sent to any StoryboundAI server

### Sudoku

A personalized dark-mode Sudoku player tuned to my personal playing experience. The puzzle generation is unbalanced and may produce extremely easy or incredibly difficult puzzles.

- Candidate highlighting, auto-candidate mode, undo/redo, pause timer, conflict detection
- Game history with timestamps and completion state (persisted in localStorage)
- Puzzle import/export in standard 81-digit format
- Background puzzle pre-generation so the next puzzle is always ready

### Timezone Tables

A timezone comparison tool for looking up and comparing local times across multiple locations simultaneously. Built with a focus on US Air Force and Space Force bases worldwide.

- 25-hour scrollable table showing current and upcoming hours across all selected locations
- Pre-loaded with 60+ US Air Force and Space Force bases (Ramstein AB, Kadena AB, Al Udeid AB, Eglin AFB, Peterson SFB, Vandenberg SFB, and more)
- World cities and countries as additional location options
- Searchable city/timezone selector; add as many columns as needed
- Drag columns to reorder; remove any column individually
- Day/night phase shading with sunrise and sunset markers per location
- Day boundary labels when the date rolls over mid-table
- Shareable URLs: selected locations are encoded in query params for easy linking
- Automatic daylight saving time handling

### KenKen

A math-based cage puzzle game with configurable grid sizes from 4×4 to 8×8. It's kinda like sudoku in some ways. This is a minor project.

---

## License

MIT — see [LICENSE](LICENSE)
