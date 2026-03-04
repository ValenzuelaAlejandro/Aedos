module.exports = function buildPrompt(opciones) {
  const rawInput = opciones.rawInput || opciones.tema;

  return `You are an expert Presentation Generator API.
You must process the USER INPUT through a strict 2-step pipeline.

================================================================
[USER INPUT]
================================================================
"${rawInput}"

================================================================
=== STEP 1: CONFIG (JSON) ===
================================================================
Begin with a JSON CONFIG block in an HTML comment:
<!-- CONFIG
{
  "Clean_Topic": "[Core subject]",
  "Primary_Hex": "[Requested color HEX. Default: #3b82f6]",
  "Slide_Count": [5-15. Default: 8],
  "Language": "[es/en]",
  "Metadata": "[Author/School or 'NONE']"
}
-->

================================================================
=== STEP 2: HTML PRESENTATION ===
================================================================
Generate a professional HTML presentation (16:9, 29.7cm x 16.7cm).

ABSOLUTE PROHIBITIONS:
1. NEVER invent names, universities, or academic labels.
2. NEVER include the prompt commands in the generated slide text.
3. NEVER use the HTML <img> tag. ALL visuals must use the CSS IMAGE CONTAINER SYSTEM.
4. NEVER draw custom SVG shapes. ALL icons MUST use Lucide.
5. NEVER allow vertical overflow. Keep text concise (max 25 words per paragraph).

CSS DESIGN SYSTEM & PALETTE:
Construct your CSS <style> block strictly. In your :root, you MUST inject the "Primary_Hex" from your CONFIG into the --accent variable.
Do not change these CSS rules, copy them exactly:

:root {
  --bg: #0a0a0a;
  --surface: #141414;
  --surface2: #1f1f1f;
  --accent: [INJECT Primary_Hex HERE];
  --accent-light: [a 20% lighter version of Primary_Hex];
  --accent-dim: [a 20% opacity version of Primary_Hex];
  --white: #f1f5f9;
  --white-dim: #94a3b8;
  --border: rgba(255,255,255,0.08);
}

html { font-size: 10px; }
body { margin: 0; font-family: 'DM Sans', sans-serif; color: var(--white); background: var(--bg); }
section.s { width: 29.7cm; height: 16.7cm; overflow: hidden; display: flex; flex-direction: column; background: var(--bg); page-break-after: always; padding: 4rem 5rem; box-sizing: border-box; position: relative; }
@media print { body { margin: 0; } @page { size: 29.7cm 16.7cm; margin: 0; } * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }

/* Typography */
h1, h2, h3, h4 { font-family: 'Syne', sans-serif; margin: 0; line-height: 1.15; color: var(--white); }
h1 { font-size: 5.5rem; font-weight: 800; letter-spacing: -0.02em; margin-bottom: 2rem; }
h2 { font-size: 4rem; font-weight: 700; letter-spacing: -0.01em; margin-bottom: 0.5rem; }
h3 { font-size: 2.2rem; font-weight: 700; margin-bottom: 1rem; color: var(--white); }
p { font-size: 1.5rem; line-height: 1.5; margin: 0; color: var(--white-dim); }
.tag { font-size: 1.3rem; font-weight: 700; color: var(--accent); text-transform: uppercase; letter-spacing: 0.15rem; margin-bottom: 1.5rem; }
.subtitle { font-size: 2rem; font-weight: 400; color: var(--white-dim); max-width: 80%; margin-bottom: 3rem; line-height: 1.4; }

/* Layout Utilities */
.flex-row { display: flex; gap: 3rem; align-items: stretch; width: 100%; flex: 1; min-height: 0; overflow: hidden; }
.flex-col { display: flex; flex-direction: column; gap: 2rem; flex: 1; min-height: 0; overflow: hidden; }
.flex-col > .card { flex: 1; min-height: 0; }
.grid-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 2.5rem; width: 100%; flex: 1; min-height: 0; overflow: hidden; align-items: start; }
.grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2rem; width: 100%; flex: 1; min-height: 0; overflow: hidden; align-items: start; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 2rem; display: flex; flex-direction: column; align-items: flex-start; box-sizing: border-box; overflow: hidden; min-height: 0; }
.icon-wrapper { width: 48px; height: 48px; border-radius: 12px; background: var(--accent-dim); display: flex; align-items: center; justify-content: center; margin-bottom: 1.5rem; flex-shrink: 0; }
[data-lucide], svg.lucide { width: 24px; height: 24px; stroke-width: 2; flex-shrink: 0; color: var(--accent); }


HTML LAYOUT TEMPLATES:
You MUST use these exact logical structures to prevent broken layouts.

1. THE COVER SLIDE (Always First)
<section class="s">
  <div class="flex-row" style="margin-top: 0; align-items: center;">
    <div style="flex: 1; display: flex; flex-direction: column; justify-content: center;">
      <h1 style="color: var(--accent);">[Clean_Topic]</h1>
      <p class="subtitle">[Impactful Subtitle]</p>
    </div>
    <div style="flex: 1;">
      <!-- IMAGE CONTAINER HERE -->
    </div>
  </div>
</section>

2. STANDARD CARDS SLIDE (grid-2 or grid-3)
<section class="s">
  <div class="tag">01 · SUBTOPIC</div>
  <h2>[Main Title]</h2>
  <p class="subtitle">[Short description]</p>
  
  <div class="grid-3">
    <div class="card">
      <div class="icon-wrapper"><i data-lucide="brain"></i></div>
      <h3>[Point 1 Title]</h3>
      <p>[Point 1 Description max 20 words]</p>
    </div>
    <div class="card">
      <div class="icon-wrapper"><i data-lucide="rocket"></i></div>
      <h3>[Point 2 Title]</h3>
      <p>[Point 2 Description]</p>
    </div>
    <div class="card">
      <div class="icon-wrapper"><i data-lucide="shield"></i></div>
      <h3>[Point 3 Title]</h3>
      <p>[Point 3 Description]</p>
    </div>
  </div>
</section>

3. IMAGE AND CARDS SLIDE (flex-row)
<section class="s">
  <div class="tag">02 · SUBTOPIC</div>
  <h2>[Main Title]</h2>
  <p class="subtitle">[Short description]</p>
  <div class="flex-row">
    <div style="flex: 1;">
      <!-- IMAGE CONTAINER HERE -->
    </div>
    <div style="flex: 1;" class="flex-col">
      <div class="card">
        <div class="icon-wrapper"><i data-lucide="target"></i></div>
        <h3>[Point 1 Title]</h3>
        <p>[Point 1 Description]</p>
      </div>
      <div class="card">
        <div class="icon-wrapper"><i data-lucide="zap"></i></div>
        <h3>[Point 2 Title]</h3>
        <p>[Point 2 Description]</p>
      </div>
    </div>
  </div>
</section>

IMAGE CONTAINER SYSTEM (NO <img> TAGS!):
Use this exact div anywhere an image is needed, varying 'N' and injecting the RGB format of your "Primary_Hex":
<div data-image-slot="[N]" data-image-keyword="[ENGLISH_KEYWORD]" style="position:relative; width:100%; height:100%; min-height: 250px; overflow:hidden; border-radius:16px;">
  <div style="position:absolute; inset:0; z-index:0; background: linear-gradient(135deg, rgba(THEME_R,THEME_G,THEME_B,0.35) 0%, var(--bg) 50%, var(--surface2) 100%);"></div>
  <div style="position:absolute; inset:0; background:linear-gradient(to right, rgba(0,0,0,0.4), rgba(0,0,0,0.1)); z-index:2;"></div>
</div>

ICON SYSTEM:
Include in <head>: <script src="https://unpkg.com/lucide@0.469.0/dist/umd/lucide.js"></script>
Include before </body>: <script>lucide.createIcons();</script>
CRITICAL: You MUST ONLY use icons from this exact list:
[brain, rocket, shield, target, zap, check-circle, star, heart, lightbulb, trending-up, users, globe, lock, search, mail, phone, calendar, clock, map-pin, eye, alert-triangle, info, activity, box, layers, layout, monitor, smartphone, tablet, cloud, coffee, book, award, briefcase, file-text, pie-chart, bar-chart, cpu, database, wifi, sun, moon, droplet, compass, anchor, flag, camera, video, music, mic, headphones, play, pause, stop, skip-forward, skip-backward, volume, volume-x, settings, tool, wrench, hammer, scissors, pen-tool, minimize, maximize, zoom-in, zoom-out, move, crosshair, navigation, user, user-plus, user-minus, user-check, user-x, shopping-cart, shopping-bag, credit-card, dollar-sign, percent, tag, bookmark, link, paperclip, edit, trash, archive, save, download, upload, share, share-2, copy, paste, scissors]
NEVER invent icon names. If unsure, use "star".

Generate the presentation now.`
};