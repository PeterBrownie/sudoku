# evolveSVG — Rendering Guide for Displacement Filters & Cross-Browser Consistency

This document describes how evolveSVG SVGs must be rendered to produce consistent displacement filter and turbulence noise output across Chrome and Firefox. It covers the SVG structure, the browser rendering pipeline that works, the pitfalls that break it, and how to handle viewBox modifications.

---

## 1. The Core Problem

evolveSVG designs use SVG filter effects — specifically `feTurbulence` + `feDisplacementMap` — to distort tiling patterns (zigzag, stripes, waves, etc.). These filters are sensitive to the **physical pixel resolution** at which the SVG is rasterized.

**Chrome and Firefox behave differently**:

- **Firefox** computes `feTurbulence` in SVG user-coordinate space. The noise pattern is always anchored to the SVG's own coordinate system, regardless of how the SVG is loaded or displayed.
- **Chrome** computes `feTurbulence` relative to the **physical pixel dimensions** of the filter region at rasterization time. If the SVG is rasterized at different pixel sizes in different contexts, Chrome produces different noise patterns.

This means the same SVG displayed at 900×506 CSS px and at 1280×720 CSS px will produce visually different displacement in Chrome, even though the SVG source is identical.

---

## 2. SVG Coordinate Space

All evolveSVG designs are built on a canonical coordinate space of **1280 × 720 SVG user units** (16:9). Every geometric value — pattern spacing, filter region extents, displacement scale — is expressed in these units.

```xml
<svg viewBox="0 0 1280 720" xmlns="http://www.w3.org/2000/svg"
     width="1280" height="720" preserveAspectRatio="xMidYMid slice">
```

`preserveAspectRatio="xMidYMid slice"` is required. It ensures the SVG fills its container by cropping excess, rather than letterboxing. Using `meet` instead changes the effective rendered scale, which alters how displacement filter magnitudes appear.

---

## 3. Filter Structure

### 3.1 Displacement filter definition

Every layer that has displacement uses a filter defined like this:

```xml
<filter id="f1"
        filterUnits="userSpaceOnUse"
        x="-384.0" y="-216.0"
        width="2048.0" height="1152.0">
  <feTurbulence type="fractalNoise"
                baseFrequency="0.0150"
                numOctaves="3"
                result="noise"/>
  <feDisplacementMap in="SourceGraphic" in2="noise"
                     scale="120.0"
                     xChannelSelector="R"
                     yChannelSelector="G"
                     result="disp"/>
</filter>
```

The filter region extents are: `x = -W*0.3`, `y = -H*0.3`, `width = W*1.6`, `height = H*1.6`  
where `W = 1280`, `H = 720`. This gives:
- `x = -384`, `y = -216`, `width = 2048`, `height = 1152`

### 3.2 Why `filterUnits="userSpaceOnUse"` is mandatory

The default `filterUnits="objectBoundingBox"` defines the filter region relative to the filtered element's bounding box. Tiling layers use a `<rect x="-1280" y="-720" width="3840" height="2160">` (3× the canvas in each direction) to ensure the pattern covers the full canvas after rotation. Its bounding box is enormous — 3840×2160 SVG units.

At high render resolutions, `objectBoundingBox` would require Chrome to allocate a filter buffer of tens of thousands of pixels per side. Chrome silently fails and produces blank or broken output. `userSpaceOnUse` pins the filter region to the SVG viewport regardless of element size.

### 3.3 Why the filter region is padded 30%

`feDisplacementMap scale` is the maximum pixel displacement in SVG user units. At `scale="120"`, pixels near the filter boundary could be displaced up to 60 SVG units outward. Without padding, the displacement would read noise from outside the filter region (implementation-defined behavior) and create hard seams at the viewport edges. The 30% padding (384 px horizontally, 216 px vertically) comfortably covers any realistic displacement value.

### 3.4 Pattern tiling coordinates

Tiling patterns use `patternUnits="userSpaceOnUse"`:

```xml
<pattern id="p1" x="0" y="0"
         width="48.00" height="24"
         patternUnits="userSpaceOnUse">
  <polyline points="0,12 12.0,0.0 36.0,24.0 48.00,12"
            fill="none" stroke="#3a7bd5" stroke-width="2.50"
            stroke-linejoin="miter"/>
</pattern>
```

All pattern parameters (spacing, amplitude, lineWidth) are **pre-scaled** by `s = W / 640 = 2.0` so they match the 1280-unit coordinate space. The raw genome values are in "640-unit" space.

The tiling rect that consumes the pattern is oversized to survive rotation:

```xml
<g transform="rotate(30.0, 640, 360)">
  <rect x="-1280" y="-720" width="3840" height="2160"
        fill="url(#p1)"/>
</g>
```

---

## 4. The Correct Rendering Pipeline

**Always render evolveSVG SVGs using an off-DOM image drawn to a canvas.** Never render them as inline SVG or as an in-DOM `<img>` with CSS size constraints.

### 4.1 Why inline SVG breaks Chrome

When an SVG is inserted into the HTML DOM via `innerHTML` or as a constrained `<img>`, Chrome rasterizes its filters at the element's CSS display size. If the container is 900×506 px, filters are computed at 900×506 (×DPR). If the container is 1280×720 px, filters are computed at 1280×720. The noise pattern scales with the window size — the displacement looks different at every viewport width.

### 4.2 Why in-DOM constrained img breaks Chrome

An `<img>` element with `max-width: 100%; max-height: 100%` in the HTML document has its CSS display size limited by the container. Chrome rasterizes the SVG at that constrained display size, not at the SVG's natural 1280×720 dimensions. Same problem as inline SVG.

### 4.3 The correct approach: off-DOM img → canvas

```javascript
function renderSVGToCanvas(svgString, canvas) {
    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    const url  = URL.createObjectURL(blob);

    const img = new Image();   // off-DOM — no CSS constraints apply
    img.onload = () => {
        // img.naturalWidth/naturalHeight == SVG's own width/height (1280 × 720).
        // Chrome rasterizes the SVG at exactly that resolution, so feTurbulence
        // and feDisplacementMap are always computed in the same coordinate space.
        const dpr = window.devicePixelRatio || 1;
        const w   = Math.round(img.naturalWidth  * dpr);
        const h   = Math.round(img.naturalHeight * dpr);
        canvas.width  = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
}
```

The canvas is then displayed via CSS (`width: 100%; height: auto` or equivalent). CSS scaling of the canvas does not re-run filter computations — it is purely a display transform on the already-rasterized pixel buffer.

**Why this works**: When `new Image()` is loaded from a Blob URL without being inserted into the DOM, the browser has no CSS context to limit its display size. Chrome uses the SVG's intrinsic dimensions (the `width` and `height` attributes) as the rasterization target. The filters are computed at 1280×720 user units × DPR — consistent and independent of window size.

---

## 5. ViewBox Modifications

The SVG `viewBox` attribute controls which portion of the 1280×720 coordinate space is visible — it is the "camera". Changing the viewBox pans or zooms the view without altering any filter, pattern, or geometry definition.

### 5.1 What viewBox does

```
viewBox="x y width height"
```

- `x, y`: top-left corner of the visible region in SVG user units
- `width, height`: size of the visible region in SVG user units

Combined with `preserveAspectRatio="xMidYMid slice"`, the viewBox region is scaled to fill the SVG element's display box, cropping any overflow.

**Default (full canvas)**: `viewBox="0 0 1280 720"`  
**Zoomed 2× on center**: `viewBox="320 180 640 360"`  
**Panned right 10%**: `viewBox="128 0 1280 720"`

### 5.2 ViewBox does not affect filter rendering

Because filters use `filterUnits="userSpaceOnUse"` with coordinates fixed to the 1280×720 space, changing the viewBox does not change how filters are computed. The noise field and displacement vectors are always calculated in the full 1280×720 coordinate space. Only the visible window into that space changes.

This means you can freely pan and zoom via viewBox without any visual discontinuity in the displacement pattern — the pattern does not shift or rescale as you change the camera.

### 5.3 Modifying viewBox for background use

To display the SVG as a webpage background with a specific crop:

```xml
<svg viewBox="200 100 880 495"
     xmlns="http://www.w3.org/2000/svg"
     width="1280" height="720"
     preserveAspectRatio="xMidYMid slice">
  <!-- same defs and layers, unmodified -->
</svg>
```

The `width` and `height` attributes on the SVG element should remain `1280 × 720` (or your target output resolution). They define the SVG's intrinsic dimensions, which is what the off-DOM img pipeline uses to determine rasterization resolution. Changing `width`/`height` changes the pixel resolution of the output; changing `viewBox` changes the field of view.

### 5.4 Computing pan and zoom as viewBox

Given a desired zoom factor `z` (1 = full canvas, 2 = 2× zoom) and pan offsets `px, py` (in normalized units, 0–1):

```javascript
const BASE_W = 1280, BASE_H = 720;

function computeViewBox(zoom, panX, panY) {
    const vbW = BASE_W / zoom;
    const vbH = BASE_H / zoom;
    const vbX = (BASE_W - vbW) / 2 + panX * vbW;
    const vbY = (BASE_H - vbH) / 2 + panY * vbH;
    return `${vbX.toFixed(2)} ${vbY.toFixed(2)} ${vbW.toFixed(2)} ${vbH.toFixed(2)}`;
}

// Examples:
computeViewBox(1,    0,    0)    // "0.00 0.00 1280.00 720.00"  (full canvas)
computeViewBox(2,    0,    0)    // "320.00 180.00 640.00 360.00"  (2× zoom, centered)
computeViewBox(1.5,  0.1, -0.1) // panned right and up at 1.5× zoom
```

---

## 6. Using the SVG as a Webpage Background

### 6.1 Canvas element approach (recommended)

Use the off-DOM img → canvas pipeline above. Place the canvas in the DOM and size it with CSS:

```html
<canvas id="bg-canvas" style="
    position: fixed;
    top: 0; left: 0;
    width: 100%; height: 100%;
    object-fit: cover;
    z-index: -1;
"></canvas>
```

```javascript
const canvas = document.getElementById('bg-canvas');
renderSVGToCanvas(svgString, canvas);
```

Because the canvas pixel buffer is fixed at 1280×720×DPR (set at draw time), the CSS `width: 100%; height: 100%` simply scales the already-rasterized image to fill the viewport. Filter quality is locked in at draw time.

If the viewport resizes significantly, re-render:

```javascript
window.addEventListener('resize', () => renderSVGToCanvas(svgString, canvas));
```

### 6.2 Animated SVG (SMIL)

evolveSVG can produce SVGs with SMIL animations (`<animate>`, `<animateTransform>` elements). SMIL only works in inline SVG — it does not animate when the SVG is loaded as a Blob URL `<img>` source in most browsers.

If you need animated displacement (the noise field itself does not animate via SMIL — only other layer parameters do), you must embed the SVG inline:

```html
<div id="bg-container" style="
    position: fixed; top: 0; left: 0;
    width: 100%; height: 100%;
    overflow: hidden; z-index: -1;
">
  <!-- SVG inserted here via innerHTML -->
</div>
```

```javascript
document.getElementById('bg-container').innerHTML = animatedSvgString;
// Restart SMIL animations from the current moment:
document.querySelectorAll('#bg-container animate, #bg-container animateTransform')
    .forEach(a => { try { a.beginElement(); } catch(e) {} });
```

**Accept the Chrome filter caveat**: Inline animated SVG will have Chrome's CSS-pixel-relative filter computation. For animated backgrounds where the displacement is part of the motion design this is usually acceptable. If pixel-exact filter accuracy is required (e.g., static background where Chrome/Firefox must match exactly), use the canvas pipeline with a CSS animation on the canvas transform instead of SMIL.

---

## 7. Checklist

When embedding an evolveSVG design as a background, verify:

- [ ] SVG has `preserveAspectRatio="xMidYMid slice"` (not `meet`)
- [ ] SVG `width` and `height` attributes are set to the canonical dimensions (1280×720 or target export size)
- [ ] Displacement filters use `filterUnits="userSpaceOnUse"` with absolute coordinates (not percentages, not `objectBoundingBox`)
- [ ] Filter region is padded 30%: `x="-384" y="-216" width="2048" height="1152"` for a 1280×720 SVG
- [ ] Rendering uses the **off-DOM img → canvas** pipeline (not `innerHTML`, not in-DOM `<img>`)
- [ ] The canvas is CSS-scaled for display, not re-rendered on every resize (or if re-rendered, the `renderSVGToCanvas` call is debounced)
- [ ] ViewBox changes are applied to the SVG string before passing to `renderSVGToCanvas` — they do not require changing any filter or pattern definition
