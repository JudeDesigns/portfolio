# 3D Modeling Service — concept homepage

An unsolicited concept built by [Jude Oba](https://judedesigns.github.io/portfolio) in September 2026,
in response to 3D Modeling Service LTD's website redesign brief.

It is a static site: open `index.html` on any web server. No build step, no framework, no CMS.

## What it demonstrates

- **Scroll-driven WebGL hero** — one model loads as a blue CAD edge pass, the PBR render fades in over it,
  the camera orbits, then the assembly explodes part by part while a spec list reveals. All scrubbed by scroll.
- **Part isolation** — hovering a row in the spec list dims every part but one and tints its emissive.
- **Portfolio viewers** — each card is a real glTF model the visitor can rotate, and open in AR on a phone.
- **Filter with View Transitions**, format chips, animated pipeline, reduced-motion and no-WebGL fallbacks.

## Stack

| Piece | Version | Why |
|---|---|---|
| three.js | r186 (vendored) | the hero scene, edge pass, exploded view |
| GSAP + ScrollTrigger | 3.15 | pinned timeline, scrubbed to scroll |
| Lenis | 1.3 | weighted smooth scroll |
| `<model-viewer>` | 4.3.1 | portfolio cards + AR, no code needed |

Everything is vendored in `vendor/` — the page has no runtime CDN dependency except Google Fonts.

## Performance notes

- Render on demand: the GPU only draws on a scroll, a pointer move or a resize.
- DPR capped at 2 (1.5 on touch).
- Models re-encoded with `gltf-transform optimize` — quantized geometry, 1k WebP textures.
  The hero model is 1.2 MB; the whole page is under 8 MB including eight interactive models.
- `prefers-reduced-motion` shows the finished frame with no pinning or scrubbing.
- No WebGL: the page degrades to a static gradient and the content still reads.

## Credits

Sample models from the [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets)
(CC0, and CC-BY 4.0 for the Wayfair and DGG models — credited in the footer). They stand in for client work.
The hero chair's upholstery was re-coloured for this concept.
