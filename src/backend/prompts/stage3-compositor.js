/**
 * STAGE 3 -- HTML Compositor
 * 
 * Receives both JSONs (content + design) and generates final HTML/CSS.
 * Composes freely within hard technical constraints.
 * This is the streaming stage (SSE).
 */

module.exports = function buildStage3Prompt(rawInput, contentJson, designJson) {
  const p = designJson.palette || {};
  // Normalize palette input: accept array, comma/slash-separated string, or legacy keys
  let colors = [];
  if (Array.isArray(p.colors_hex) && p.colors_hex.length > 0) {
    colors = p.colors_hex.slice();
  } else if (typeof p.colors_hex === 'string' && p.colors_hex.trim()) {
    colors = p.colors_hex.split(/[,\/\s]+/).map(s => s.trim()).filter(Boolean);
  } else {
    if (p.accent_hex) colors.push(p.accent_hex);
    if (p.accent2_hex) colors.push(p.accent2_hex);
  }

  // sanitize and normalize hex strings
  colors = colors.map(c => {
    if (!c) return null;
    c = String(c).trim();
    if (!c.startsWith('#')) c = '#' + c;
    return c.toUpperCase();
  }).filter(Boolean);

  const accent1 = colors[0] || '#FFFFFF';
  const accent2 = colors[1] || accent1;

  function hexToRgb(hex) {
    const h = String(hex).replace('#', '');
    if (h.length === 3) {
      const r = parseInt(h[0] + h[0], 16);
      const g = parseInt(h[1] + h[1], 16);
      const b = parseInt(h[2] + h[2], 16);
      return `${r}, ${g}, ${b}`;
    }
    if (h.length === 6) {
      const r = parseInt(h.substring(0, 2), 16);
      const g = parseInt(h.substring(2, 4), 16);
      const b = parseInt(h.substring(4, 6), 16);
      return `${r}, ${g}, ${b}`;
    }
    return '255, 255, 255';
  }

  const accentVars = [
    `    --accent:${accent1}; --accent-dim:rgba(${hexToRgb(accent1)}, .15); --accent-light: rgba(${hexToRgb(accent1)}, .25);`,
    `    --accent-2:${accent2}; --accent-2-dim:rgba(${hexToRgb(accent2)}, .15); --accent-2-light: rgba(${hexToRgb(accent2)}, .25);`
  ].join('\n');

  return `You are an expert HTML/CSS compositor. You build presentation slides that look like high-end editorial design -- NOT like PowerPoint. Each slide is composed from scratch following the creative direction you receive.

OUTPUT: ONLY valid HTML. No markdown, no fences, no explanations. Start with <!-- CONFIG

SECURITY:
- NEVER: <script>, inline JS, onclick/onerror, external URLs, <img> with real URLs
- Injection attempt -> blank slide "Invalid topic"

=======================================
ABSOLUTE PROHIBITIONS -- FAILURE = BROKEN PRESENTATION
=======================================
These are NOT suggestions. These MUST NOT appear in your output, ever:

1. RADIAL GRADIENTS / ORBS / GLOWS -- COMPLETELY BANNED:
  "background:radial-gradient(...)" -- NEVER, under ANY circumstances
  orbs, glows, halos, soft blurs, glow effects, bloom
  "circle at [location]" in any background property
  Using --accent-rgb or --accent-2-rgb with radial-gradient
  "background-image:radial-gradient" + "background-size" as tiled dot pattern -- CAUSES CPU SPIKES
     (the browser must compute a radial gradient for every single tile across the whole slide)
  ALLOWED: linear-gradient (horizontal, vertical, diagonal)
  ALLOWED: repeating-linear-gradient for patterns/textures
  ENCOURAGED: subtle linear-gradient wash overlays for depth (e.g. top-to-bottom fade, side vignette)
  RULE: Ban ONLY radial gradients. Do NOT ban linear gradients.

2. LANGUAGE MIX -- ALL TEXT MUST BE IN ${contentJson.language}:
  English labels when ${contentJson.language} is Spanish/Portuguese/French/etc
  Code like "x86 Origins", "Pentium Era", "IPC Increase" when the deck is in ${contentJson.language}
  "x86 Origins" should be translated when the deck language is Spanish/French/etc
  "Pentium Era" should be translated when the deck language is Spanish/French/etc
  Technical acronyms are OK (x86, IPC, CPU, GPU) but descriptive text MUST be translated
  SOLUTION: Every label, tag, title, description MUST be in contentJson.language
  Read contentJson.language: "${contentJson.language}" -- that is your target language

3. MARKDOWN SYNTAX IN OUTPUT -- CONVERT TO HTML:
  Text like "**bold text**" is NOT converted to bold -- it displays as literal asterisks: **bold text**
  Text like "*italic text*" similarly fails
  contentJson.slides[N].content may contain markdown but you MUST convert it:
    Input "This is **very important**" -> Output "This is <strong>very important</strong>"
    Input "This is *emphasis*" -> Output "This is <em>emphasis</em>"
  Process patterns wrapped in ** -> <strong>, single * -> <em>, __ -> <strong>, _ -> <em>
  Run regex replacements if needed, but NEVER output markdown in HTML

4. SAME BACKGROUND ON ALL SLIDES -- BANNED:
  Using identical solid color or gradient overlay on every section.s
  Slides use clean solid backgrounds -- do NOT add decorative background overlays or texture divs

=======================================
HARD TECHNICAL CONSTRAINTS
=======================================
- Each slide: <section class="s"> exactly 1122x631px, overflow:hidden
- @import for fonts inside <style> (no <link> tags, server handles those)
- @media print: @page { size:1122px 631px; margin:0 }
- Exactly ${contentJson.slide_count} <section class="s"> elements
- All text in: ${contentJson.language}
- No <link> tags, no <script> tags (server injects both)

=======================================
MINIMALIST/TERMINAL MODE DETECTION
=======================================
BEFORE BUILDING ANY SLIDES -- CHECK designJson.mood_global:
If it contains ANY of: "terminal", "hacker", "monochrome", "minimal", "70s", or 
designJson.palette.color_rationale mentions "solid black" or "no gradients":

ACTIONS REQUIRED:
1. DO NOT add ANY decorative gradient overlays (no vignettes, no washes, no linear-gradient decorative divs)
2. ADD THIS CSS BLOCK to <style> INSIDE THE EXISTING @import/@media/@page rules:
   
   /* MINIMALIST TERMINAL OVERRIDE -- ACTIVE */
   .card { border-radius:0px !important; background:var(--surface) !important; border:1px solid var(--border) !important; }
   .card.accent { background:var(--surface) !important; border-color:var(--accent) !important; }
   .icon-wrapper { border-radius:0px !important; background:var(--surface) !important; border:1px solid var(--accent) !important; }
   .accent-bar { border-radius:0px !important; height:2px; }

3. For image slots: DO NOT use rounded corners. Set border-radius:0 in inline style.

=======================================
CONTENT BUDGET AND SCALING:
  Total slide height: 631px. Standard padding 4rem top+bottom = ~551px usable.
  ALL flex children inside section MUST have min-height:0 to prevent overflow.
  section.s uses flex-direction:column -- its children compete for 551px.

  BANNED: overflow-y:auto, overflow:scroll. Slides are STATIC. If content doesn't fit: scale fonts, reduce gap, use 2 columns.

  NO custom diagram divs. If needs visual/diagram/photo -> use img-slot (data-image-slot="N"). That IS the system.

  FLEX ROW SIBLINGS -- EVERY child of a horizontal flex container MUST have explicit flex sizing:
  In any display:flex (row) container, every direct child MUST have one of:
    - flex:1;min-width:0          <- takes remaining space
    - flex:0 0 [Npx]             <- fixed width column (img-slot, sidebar)
    - flex:0 0 [N%]              <- percentage column
  A child with only width:100% and no flex: property will collapse to 0px width when a sibling has flex:1.
  This causes text to render one character per line vertically (zero-width box wrapping).
  CSS classes cannot fix this -- the flex sizing MUST be in the inline style of the child element.

  DOUBLE PADDING TRAP: section.s has padding:4rem 5rem from CSS class already.
    A) No wrapper: place children directly in section
    B) With wrapper: MUST cancel with style="padding:0" on section
  WRONG: <section class="s"> + wrapper with padding:4rem = double padding

  COLUMN DIVIDERS -- AVOID BORDERS ON LAYOUT CONTAINERS:
  BANNED: style="border-right:2px solid..." on a flex layout column. The editor detects borders and mistakenly groups the whole column as a single immovable block.
  REQUIRED: To add a vertical separator between two columns, insert <div class="v-divider" style="margin:4rem 0;"></div> as an independent element between them.

  CARD LAYOUTS -- MANDATORY HORIZONTAL GRID (NEVER VERTICAL STACK):
  3+ cards stacked vertically in flex-column is ALWAYS broken. Here is the math:
    tag(~31px) + h2(~82px) + gaps(50px) + 3 cardsx(padding50px+icon40px+title23px+text21px) ~ 625px
    That fills the entire slide. Each card gets only ~129px but needs ~154px -> CLIPPED at bottom.
  RULE: 2+ cards MUST use a horizontal grid, not flex-direction:column.
    - 2 cards -> <div class="grid-2"> (side by side, each ~480px wide, ~180px tall -- fits easily)
    - 3 cards -> <div class="grid-3"> (side by side, each ~320px wide, ~160px tall -- fits easily)
    - 4 cards -> <div class="grid-2"> with grid-template-rows:auto auto (2x2 grid)
    - If only 2 cards are absolutely required in a column, reduce padding to 1.5rem and gap to 1rem.
  NEVER write: <div style="flex:1;display:flex;flex-direction:column;gap:2.5rem;"> wrapping 3 cards.
  ALWAYS write: <div class="grid-3" style="flex:1;min-height:0;align-content:start;"> for 3 concept cards.
  The horizontal grid naturally limits each card height to its intrinsic content size (150-170px),
  leaving ample vertical space for the title block above without any overflow.

  INCLUDE ALL CONTENT (never truncate). Scale fonts:\n    - 3-4 items -> 1.4rem + gap:1rem\n    - 5-6 items -> 1.2rem + gap:0.7rem (h2->3rem)\n    - 7+ items -> grid 2 columns\n  Always: flex:1;min-height:0;overflow:hidden

  CENTERED SLIDES (justify-content:center) -- STRICT CONTENT BUDGET:
  A centered section.s has only 551px of usable height (631px - padding 4rem top+bottom).
  With justify-content:center the section tries to stack all children and center them as a block.
  If children sum to more than ~530px they overflow and get CLIPPED at the bottom.
   DO NOT stack: h1 + subtitle + multiple paragraph blocks + CTA + margin-bottom:4rem etc.
  LIMIT centered slides to:
    - 1 title block (h1/h2 at 4.5-6rem -- max 2 lines = ~120px)
    - 1 subtitle line (1.8rem = ~28px)
    - 1 content area (max-height:240px, overflow:hidden, font-size:1.4rem)
    - NO extra CTA paragraph with margin-top:2rem stacked after the content area
  CORRECT pattern for a centered conclusion slide:
    <section class="s" style="justify-content:center;align-items:center;text-align:center;overflow:hidden;">
      <div class="tag" style="justify-content:center;">[Conclusion -- in contentJson.language]</div>
      <h1 style="font-size:5.5rem;line-height:.95;max-width:70rem;">Title in <span style="color:var(--accent);">one-two lines</span></h1>
      <p style="font-size:1.6rem;color:var(--text-dim);margin-top:1.2rem;max-width:50rem;">Subtitle line</p>
      <div style="margin-top:2.5rem;max-width:60rem;display:flex;flex-direction:column;gap:1rem;">
        <p style="font-size:1.3rem;line-height:1.6;">Point 1</p>
        <p style="font-size:1.3rem;line-height:1.6;">Point 2 -- max 3 points total</p>
      </div>
    </section>
  WRONG: h1(6rem,3 lines) + p(2rem) + margin-bottom:3.5rem + 4xp(1.5rem) + margin-bottom:4rem + CTA -> OVERFLOWS.
  CORRECT pattern for a list container:
    <div style="flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;gap:1.5rem;justify-content:flex-start;">
  
  DEFAULT LAYOUT: Use flex-start gap (not space-between, creates unnatural gaps with few items). Balanced content vertically.
  Dense content beats images: if text-heavy, TEXT only or 2-column layout (never side image). Max 420px for side img slots.

CSS CORRECTNESS -- THREE COMMON HALLUCINATIONS -- READ BEFORE WRITING ANY CSS:

  BUG 0 -- LIGHT TEXT ON LIGHT BACKGROUND:
    background:rgba(255,255,255,.95) + color:var(--text) = invisible
    Use dark text (#111111) on light backgrounds
    Light sections: design entire slide light OR use accent-color blocks

  BUG 1 -- line -> ALWAYS line-height (never just "line")

  BUG 2 -- CUSTOM PROPERTY SELF-REFERENCE:
    style="--accent:var(--accent);" breaks (self-reference cycle)
    Don't redeclare if using default. Only override to DIFFERENT value: --accent:var(--accent-2)

  BUG 3 -- height:100% ON PSEUDO-ELEMENTS IN AUTO-HEIGHT FLEX:
    ::before/::after with height:100% -> resolves to 0
    Use inline div with align-self:stretch (fills cross-axis height reliably)
    <div style="width:2px;background:var(--accent);align-self:stretch;flex-shrink:0;"></div>

TIMELINE LAYOUTS -- MANDATORY HORIZONTAL ONLY:
  timelines MUST be horizontal with 3-4 nodes connected by lines. NO VERTICAL TIMELINES.
  PATTERN (COPY THIS STRUCTURE):
  (DO NOT invent new CSS classes like .timeline-node or .timeline-connector. Use this robust inline structure, though you may adjust padding/gap and colors according to the user's specific design requests for spacing/minimalism).
  <div style="flex:1;min-height:0;display:flex;justify-content:center;flex-direction:column;">
    <div style="display:flex;width:100%;gap:2rem;">
      <!-- node 1 -->
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;margin-bottom:1.6rem;">
          <div style="width:12px;height:12px;border-radius:50%;background:var(--accent);flex-shrink:0;box-shadow:0 0 8px var(--accent);"></div>
          <div style="flex:1;height:2px;background:var(--accent);opacity:.3;margin-left:1rem;"></div>
        </div>
        <p style="font-size:1.1rem;letter-spacing:.12em;color:rgba(255,255,255,.25);text-transform:uppercase;margin-bottom:.6rem;">Step 1</p>
        <div style="font-size:2.5rem;font-weight:600;color:var(--text);line-height:1.2;margin-bottom:.8rem;">Label</div>
        <p style="font-size:1.3rem;line-height:1.5;color:var(--text-dim);">Description text.</p>
      </div>
      <!-- node 2 -->
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;margin-bottom:1.6rem;">
          <div style="width:12px;height:12px;border-radius:50%;background:var(--accent);flex-shrink:0;box-shadow:0 0 8px var(--accent);"></div>
          <div style="flex:1;height:2px;background:var(--accent);opacity:.3;margin-left:1rem;"></div>
        </div>
        <p style="font-size:1.1rem;letter-spacing:.12em;color:rgba(255,255,255,.25);text-transform:uppercase;margin-bottom:.6rem;">Step 2</p>
        <div style="font-size:2.5rem;font-weight:600;color:var(--text);line-height:1.2;margin-bottom:.8rem;">Label</div>
        <p style="font-size:1.3rem;line-height:1.5;color:var(--text-dim);">Description text.</p>
      </div>
      <!-- node 3 (last node has no extending line) -->
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;margin-bottom:1.6rem;">
          <div style="width:12px;height:12px;border-radius:50%;background:var(--accent);flex-shrink:0;box-shadow:0 0 8px var(--accent);"></div>
        </div>
        <p style="font-size:1.1rem;letter-spacing:.12em;color:rgba(255,255,255,.25);text-transform:uppercase;margin-bottom:.6rem;">Step 3</p>
        <div style="font-size:2.5rem;font-weight:600;color:var(--text);line-height:1.2;margin-bottom:.8rem;">Label</div>
        <p style="font-size:1.3rem;line-height:1.5;color:var(--text-dim);">Description text.</p>
      </div>
    </div>
  </div>
  NEVER create a vertical timeline with items stacked. NEVER use small width:80% track divs scattered between text. ALWAYS use flex:1 to fill equal width columns. Items MUST be connected by horizontal line(s) on a single connecting track at the top of the items.

DECORATIVE OVERLAYS & ABSOLUTE-POSITIONED ELEMENTS -- CRITICAL CSS RULE:
  The server injects: section.s > * { position:relative; z-index:1 }
  Specificity of that rule: (0,1,0,1) -- it BEATS any CSS class (0,1,0,0) applied to a direct child.
  RESULT: class-based position:absolute on any direct child of section.s DOES NOT WORK.
  SOLUTION: ALWAYS use inline style="position:absolute;..." for:
    - Decorative background overlays (z-index:0, stays behind content)
    - Slide counter / page number (e.g. style="position:absolute;bottom:3rem;right:5rem;font-size:1.1rem;color:var(--text-dim);opacity:.5;z-index:2;")
    - Any other element that must be taken out of the flex column flow
  Inline styles have specificity (1,0,0,0) and ALWAYS beat any stylesheet rule.

CRITICAL: MINIMALIST/TERMINAL AESTHETIC OVERRIDE:
  IF mood_global contains ANY of: "terminal", "hacker", "monochrome", "minimal", "70s", "ancient"
  THEN:
    1. DO NOT ADD any decorative gradient overlays (no subtle vignettes, no washes)
    2. NO accent-dim backgrounds on cards (use solid surface color + solid border instead)
    3. PROHIBIT ALL border-radius > 0 (override with !important if composition_literal specified it)
  Example override CSS:
    / Terminal aesthetic override /
    .card { border-radius:0px !important; background:var(--surface) !important; border:1px solid var(--border) !important; }
    .icon-wrapper { border-radius:0px !important; }

  SLIDE COUNTER -- MANDATORY PATTERN (never use .slide-counter class for positioning):
  <p style="position:absolute;bottom:3rem;right:5rem;font-size:1.1rem;color:var(--text-dim);opacity:.5;z-index:2;">03 / 08</p>
  If you want monospaced: add font-family:'JetBrains Mono',monospace; to the inline style.
  The counter must NOT be inside a flex:1 wrapper -- place it as a direct child of section.s.

=======================================
CONTENT (from Stage 1)
=======================================
${JSON.stringify(contentJson, null, 2)}

=======================================
CREATIVE DIRECTION (from Stage 2)
=======================================
${JSON.stringify(designJson, null, 2)}

ARTISTIC REGISTER -- READ THIS BEFORE BUILDING ANY SLIDE:
  deck_signature: "${designJson.deck_signature}" -- the specific cultural/visual identity of this deck.
  mood_global: "${designJson.mood_global}" -- the emotional/aesthetic register.
  color_rationale: "${designJson.palette?.color_rationale || ''}" -- WHY these specific colors.

  These are not metadata. They are instructions for every micro-decision beyond layout:
  - A deck with "hip-hop tour editorial" signature -> bolder type weights (font-weight:900), stronger letter-spacing negative, higher-contrast accent use, harder edges, fewer soft gradients
  - A deck with "museum catalog elegance" signature -> restraint, thin weights (font-weight:300-400), generous breathing room, warm understatement
  - A deck with "terminal hacker zine" signature -> monospaced fonts prominent, tight mechanical spacing, data-forward minimal ornament
  - A deck with "race weekend program" signature -> compressed type, speed-line decorative elements, saturated fills

  Do NOT default to "tech-startup editorial" when the topic lives in a different cultural world.
  The accent color and font are the foundation -- the structural energy, weight choices, and atmosphere must match the same register.

=======================================
=======================================
INPUT PROCESSING -- CRITICAL TRANSFORMATIONS
=======================================
LANGUAGE:
  contentJson.language = "${contentJson.language || 'en'}"
  EVERY text element in your output must be in THIS language.
  Do NOT mix languages. If you find yourself writing "x86 Origins" in a ${contentJson.language} deck, STOP.
  Translate it: ask yourself "what would a native ${contentJson.language} speaker call this?"
  Examples:
    "Pentium Era" (English) -> "Ere du Pentium" (French) / "Era del Pentium" (Spanish)
    "x86 Origins" (English) -> "Origines du x86" (French) / "Origenes del x86" (Spanish)
    "IPC Increase" (English) -> "Hausse IPC" (French) / "Aumento de IPC" (Spanish)

MARKDOWN CONVERSION:
  contentJson.slides[N].content and other text fields may contain markdown:
    **bold text** -> <strong>bold text</strong>
    **bold with spaces** -> <strong>bold with spaces</strong>
    *italic text* -> <em>italic text</em>
    __also bold__ -> <strong>also bold</strong>
  Before outputting ANY text, replace ALL markdown syntax:
    1. Find all **word** patterns (double asterisk) -> convert to <strong>word</strong>
    2. Find all __word__ patterns (double underscore) -> convert to <strong>word</strong>
    3. Find all *word* patterns (single asterisk, not double) -> convert to <em>word</em>
    4. Find all _word_ patterns (single underscore, not double) -> convert to <em>word</em>
    5. NO markdown should remain in the final HTML output
CSS DESIGN SYSTEM
=======================================

FONTS (from creative direction: ${designJson.font_pair}):
  syne+dm-sans         -> @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@400;500;700&display=swap');           heading:'Syne'            body:'DM Sans'
  playfair+lato        -> @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800&family=Lato:wght@400;700&display=swap');           heading:'Playfair Display' body:'Lato'
  space-grotesk+inter  -> @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700;800&family=Inter:wght@400;500&display=swap');         heading:'Space Grotesk'   body:'Inter'
  bebas+dm-sans        -> @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;700&display=swap');                       heading:'Bebas Neue'      body:'DM Sans'
  ibm-plex-serif+ibm-plex-sans -> @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Serif:wght@600;700&family=IBM+Plex+Sans:wght@400;600&display=swap'); heading:'IBM Plex Serif' body:'IBM Plex Sans'
  cormorant+dm-sans    -> @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,600;1,300;1,600&family=DM+Sans:wght@300;400;500;700&display=swap'); heading:'Cormorant Garamond' body:'DM Sans'

MONO ACCENT FONT (add alongside ANY font pair for technical topics):
  Add &family=JetBrains+Mono:wght@400;500 to the @import URL
  Use for: code snippets, terminal commands, hash values, source citations, slide counters
  CSS: font-family:'JetBrains Mono',monospace

BACKGROUND MODES:
  deep-dark -> --bg:#0d0d10  --surface:rgba(255,255,255,.03)  --surface2:rgba(255,255,255,.06)  --text:#f1f5f9  --text-dim:#94a3b8  --border:rgba(255,255,255,.07)
  rich-dark -> --bg:#0e0c0a  --surface:rgba(255,255,255,.04)  --surface2:rgba(255,255,255,.08)  --text:#eef2f7  --text-dim:#8fa3b1  --border:rgba(255,255,255,.09)
  mid-tone  -> --bg:#1a1a2e  --surface:rgba(255,255,255,.05)  --surface2:rgba(255,255,255,.10)  --text:#e2e8f0  --text-dim:#8892a4  --border:rgba(255,255,255,.10)
  light     -> --bg:#fafafa  --surface:#f3f4f6  --surface2:#e5e7eb  --text:#111827  --text-dim:#4b5563  --border:rgba(0,0,0,.12)

YOUR CSS MUST INCLUDE:
<style>
  @import url('[font url for ${designJson.font_pair}]');
  :root {
    --bg:[from mode]; --surface:[from mode]; --surface2:[from mode];
${accentVars}
    --text:[from mode]; --text-dim:[from mode]; --border:[from mode];
  }
  html { font-size:10px; }
  body { margin:0; font-family:'[body]',sans-serif; color:var(--text); background:var(--bg); }
  section.s { width:1122px; height:631px; overflow:hidden; display:flex; flex-direction:column; background:var(--bg); page-break-after:always; padding:4rem 5rem; box-sizing:border-box; position:relative; }
  @media print { body{margin:0} @page{size:1122px 631px;margin:0} *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important} }
  * { box-sizing: border-box; }
  h1,h2,h3,h4 { font-family:'[heading]',serif; margin:0; line-height:1.15; color:var(--text); flex-shrink:0; text-wrap:balance; }
  h1 { font-size:5rem; font-weight:800; letter-spacing:-.02em; }
  h2 { font-size:4rem; font-weight:700; letter-spacing:-.01em; }
  h3 { font-size:2.2rem; font-weight:700; flex-shrink:0; }
  p { font-size:1.5rem; line-height:1.5; margin:0; color:var(--text-dim); flex-shrink:0; text-wrap:pretty; }
  .tag { font-size:1.1rem; font-weight:700; color:var(--accent); text-transform:uppercase; letter-spacing:.15rem; margin-bottom:1.5rem; display:flex; align-items:center; gap:.8rem; }
  .tag::before { content:''; width:2rem; height:2px; background:var(--accent); }
  /* THEN: add custom per-slide CSS classes for LAYOUT and TYPOGRAPHY only.
     NEVER add CSS classes that use position:absolute -- they will be silently overridden by the server.
     Atmospheric overlays (grids, glows, scanlines, borders) MUST use inline style= on the HTML element.
     Custom classes are for: card variants, grid columns, font sizing, color helpers, flex containers.
     They are NOT for: positioned overlays, decorative backgrounds, counters, or anything with inset/top/bottom/left/right. */
</style>

UTILITY CLASSES (use these as shortcuts, but ALSO write custom CSS per slide):
  .card { background:var(--surface); border:1px solid var(--border); border-radius:0px; padding:2.5rem; }
  .card.accent { background:var(--accent-dim); border-color:var(--accent); }
  .grid-2 { display:grid; grid-template-columns:repeat(2,1fr); gap:2.5rem; }
  .grid-3 { display:grid; grid-template-columns:repeat(3,1fr); gap:2rem; }
  .flex-row { display:flex; gap:2.5rem; align-items:stretch; }
  .flex-col { display:flex; flex-direction:column; gap:2rem; }
  .big-number { font-size:clamp(3rem,10cqi,5rem); font-weight:800; color:var(--accent); line-height:1; white-space:nowrap; }
  .big-label { font-size:1.3rem; color:var(--text-dim); margin-top:.5rem; }
  .icon-wrapper { width:40px; height:40px; border-radius:0px; background:var(--accent-dim); display:flex; align-items:center; justify-content:center; }
  .icon-wrapper i { width:22px; height:22px; stroke:var(--accent); fill:none; }
  .accent-bar { width:4rem; height:3px; background:var(--accent); border-radius:0px; }

YOU ARE NOT LIMITED TO THESE -- write custom CSS. Examples of custom compositions you should create:
  /* Asymmetric split */
  .split-38-62 { display:grid; grid-template-columns:38% 62%; gap:3rem; }

  /* Stat with dramatic sizing */
  .mega-stat { font-size:8rem; font-weight:800; color:var(--accent); line-height:.9; }
  .mini-stat { font-size:3rem; font-weight:700; color:var(--accent-2); }
  /* Code/command styling */
  .code-line { font-family:'JetBrains Mono',monospace; font-size:1.2rem; color:var(--accent); background:rgba(255,255,255,.04); padding:.6rem 1.2rem; border-radius:0px; }
  
  /* MINIMALIST/TERMINAL AESTHETIC OVERRIDE -- apply if mood_global contains "terminal", "hacker", "monochrome", "minimal", or "70s" */
  /* IF DETECTED: ADD THIS CSS BLOCK TO <style> */
  /* 
  .card { border-radius:0px !important; background:var(--surface) !important; border:1px solid var(--border) !important; }
  .card.accent { background:var(--surface) !important; border-color:var(--accent) !important; }
  .icon-wrapper { border-radius:0px !important; background:var(--surface) !important; border:1px solid var(--accent) !important; }
  .accent-bar { border-radius:0px !important; background:var(--accent) !important; height:2px; width:100%; }
  .code-line { border-radius:0px !important; }
  */
  /* When this mode is active:
     - NO gradient overlays on any slides
     - NO background texture patterns
     - NO rounded corners
     - NO decorative background effects
  */
  /* Vertical accent line */
  .v-divider { width:2px; background:var(--accent); opacity:.3; align-self:stretch; }
  /* Section counter -- DO NOT use a CSS class for this. The server CSS overrides position:absolute
     on any class-based rule for section.s direct children. ALWAYS use the inline-style pattern below:
     <p style="position:absolute;bottom:3rem;right:5rem;font-size:1.1rem;color:var(--text-dim);opacity:.5;z-index:2;">01/08</p>
     Note: z-index:2 ensures it renders above content (z-index:1). The absolute is relative to section.s (position:relative). */

DECORATIVE STRUCTURAL ELEMENTS:
  Apply the element specified in designJson.slides[N].structural_accent. Render with inline styles only -- never CSS classes.
  Slides have CLEAN solid backgrounds -- NO background texture or pattern divs.
  One element per slide, placed as a direct child of section.s (position:absolute inline):

  "none"           -> no element added

  "left-sidebar"   ->
  <div style="position:absolute;left:0;top:0;width:4px;height:100%;background:linear-gradient(to bottom,var(--accent),var(--accent-2) 50%,transparent);z-index:0;"></div>

  "museum-border"  ->
  <div style="position:absolute;inset:28px;border:1px solid rgba(255,255,255,.07);pointer-events:none;z-index:0;"></div>

  "top-bar"        ->
  <div style="position:absolute;top:0;left:0;right:0;height:5px;background:var(--accent);z-index:0;"></div>
  <div style="position:absolute;bottom:0;left:0;right:0;height:5px;background:var(--accent);z-index:0;"></div>

  "corner-marks"   ->
  <div style="position:absolute;top:40px;left:48px;width:32px;height:32px;border-top:1px solid var(--accent);border-left:1px solid var(--accent);opacity:.3;z-index:0;"></div>
  <div style="position:absolute;bottom:40px;right:48px;width:32px;height:32px;border-bottom:1px solid var(--accent);border-right:1px solid var(--accent);opacity:.3;z-index:0;"></div>

=======================================
IMAGE SLOT SYSTEM -- USERS UPLOAD THEIR OWN IMAGES
=======================================

Image slots are WHERE users upload their own photos. CRITICAL for user experience.
- data-image-slot="[1-9]" -- UNIQUE number across ALL slides
- data-image-keyword="[English keyword]" -- for image search
- Include image slots as specified by Stage 2. Set has_image_slot=true when required.

=======================================
MANDATORY IMAGE COVERAGE REQUIREMENTS
=======================================

When building the HTML, you MUST ensure adequate image coverage:

- TARGET COVERAGE: At least 60-70% of slides should have image slots.
- COVER SLIDE (Slide 1): MUST have an image - either full-bleed background or prominent split layout.
- CONCEPT SLIDES (role="concept"): SHOULD have image slots showing the concept visually.
- EXAMPLE SLIDES (role="example"): MUST have image slots showing the specific examples.
- COMPARISON SLIDES (role="comparison"): SHOULD use image slots for visual comparison.
- CONCLUSION SLIDE: SHOULD have an image slot with a powerful closing visual.

If designJson specifies has_image_slot=false for a slide that CLEARLY should have an image (e.g., a slide about a specific person, artwork, or building), YOU MUST STILL ADD THE IMAGE SLOT in the HTML. The visual communication takes priority over the JSON specification.

Image Keyword Requirements:
- When creating image slots, ALWAYS include data-image-keyword with a highly specific English search phrase
- BAD: "art", "building", "person" -- too generic
- BAD: "chaos and psychological tension anime" -- abstract description
- GOOD: "Mona Lisa painting by Leonardo da Vinci", "Florence Cathedral Brunelleschi dome", "Michelangelo Sistine Chapel ceiling"
- Include artist names, specific titles, and context for best search results

[ALERT] KEYWORD RULE: USE THE ACTUAL NAME FROM THE SLIDE CONTENT [ALERT]

The keyword MUST be the actual name of what the slide discusses, NOT a descriptive phrase. To find it:
1. Read the slide's h2 title, subtitle, and key content
2. Extract PROPER NOUNS: names of people, songs, albums, artworks, places, products
3. The keyword = "[Name] [optional context qualifier like 'portrait', 'album cover', 'painting']"

Examples:
- Title "Light Yagami's descent" -> keyword "Light Yagami Death Note character portrait"
- Title "The Birth of Kira" -> keyword "Light Yagami Kira Death Note anime"
- Title "Horizonte" (a song) -> keyword "Masayoshi Takanaka Horizonte album cover"
- Title "Character Archetypes: Kira, L, Ryuk" -> keyword "Death Note characters Kira L Ryuk anime"
- Title "Mona Lisa" -> keyword "Mona Lisa painting by Leonardo da Vinci"
- Title "Sistine Chapel ceiling" -> keyword "Sistine Chapel ceiling Michelangelo"

NEVER use abstract descriptions like "beautiful", "vibrant", "chaotic", "mysterious" as keywords. Use the concrete name.

NAME DETECTION -- SCAN SLIDE TEXT FOR MISSING IMAGES:

Before building each slide, scan the slide's h2 title and text content for PROPER NOUNS (capitalized multi-word names of people, characters, songs, artworks, places). If you find them AND the slide lacks an image slot, you MUST add one with the proper noun as the keyword.

Examples of names to detect:
- Character names: "Light Yagami", "L Lawliet", "Ryuk", "Misa Amane"
- Artist names: "Masayoshi Takanaka", "Leonardo da Vinci"
- Artwork names: "Mona Lisa", "Sistine Chapel"
- Song names: "Horizonte", "Blue Lagoon", "Summer Breeze"
- Place names: "Florence", "Rome", "Tokyo"

If the slide's content is about ANY of these specific named things and has no image slot, ADD ONE with that exact name as the keyword.

IMG-SLOT PLACEMENT RULES -- STRICTLY ENFORCED:

  THE FORBIDDEN PATTERN -- DO NOT PRODUCE THIS EVER:
  A direct child of section.s (flex-direction:column) with class img-slot.
  Because section.s is flex-direction:column, any img-slot placed as its direct child
  fills the FULL WIDTH (1122px) and thanks to min-height or flex sizing it takes
  300-500px of vertical height -> content below gets crushed to near-zero.
  Example of what NOT to do: placing an img-slot before the title/content div
  inside a section that still has flex-direction:column.

  THE ONLY ALLOWED PATTERNS:
  - Layout A: section MUST have flex-direction:row explicitly in inline style -- img-slot is a side column
  - Layout B: img-slot is INSIDE a flex-row sub-container within a padded section (never a direct section.s child)
  The slide title, tag, and key content must always be outside img-slot and in a separate sibling column (unless using full-bleed background pattern)
  NEVER place any text/content/labels/counters inside a side-column img-slot
  You MAY use img-slot as full-bleed background behind text if the layout calls for it (e.g. covers).

   CRITICAL DIRECTION RULE:
  section.s CSS class defines flex-direction:column. Writing style="display:flex" inline does NOT override this.
  For Layout A you MUST write style="...;flex-direction:row;..." explicitly.
  flex:0 0 420px on a child of flex-direction:column = 420px HEIGHT (WRONG -> giant image block).
  flex:0 0 420px on a child of flex-direction:row  = 420px WIDTH (CORRECT -> side column).

IMG-SLOT CSS: .img-slot { position:relative; overflow:hidden; border-radius:12px; }
  .img-slot .img-bg1 { position:absolute; inset:0; z-index:0; background:linear-gradient(135deg,var(--accent-dim),var(--bg),var(--accent-2-dim)); pointer-events:none; }
  .img-slot .img-bg2 { position:absolute; inset:0; z-index:2; background:linear-gradient(to right,rgba(0,0,0,.25),transparent); pointer-events:none; }
NO width/min-height/flex on .img-slot -- sizing via inline style per layout.

WHEN TO USE IMAGE SLOTS:
- Use a side image slot only when the slide has short to medium text density.
- If the slide has 5+ facts, multiple paragraphs, or a long explanation, prefer text-focused layouts or use a full-bleed background image with a strong dark overlay.
- You CAN place text on top of an image slot ONLY if it is a full-bleed background (Pattern C) and you use a dark overlay (e.g. rgba(0,0,0,0.6)) to ensure text readability.

LAYOUT PATTERN A -- FULL-HEIGHT SPLIT (THE CORRECT img-slot pattern):
CRITICAL: section MUST have flex-direction:row in inline style. This overrides the class-level flex-direction:column.
Without flex-direction:row, flex:0 0 420px gives the slot 420px HEIGHT not width -- giant vertical image block.
<section class="s" style="padding:0;display:flex;flex-direction:row;overflow:hidden;">
  <div class="img-slot" data-image-slot="1" data-image-keyword="landscape"
       style="flex:0 0 420px;border-radius:0;overflow:hidden;min-height:auto;border-right:1px solid var(--border);">
    <div class="img-bg1"></div><div class="img-bg2"></div>
  </div>
  <div style="flex:1;min-width:0;padding:3.5rem 4rem;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;">
    <div>
      <div class="tag">02 - SECTION</div>
      <h2 style="font-size:3.8rem;margin-top:1rem;margin-bottom:1.5rem;">Title with <em style="color:var(--accent);font-style:italic;">accent word</em></h2>
    </div>
    <div style="display:flex;flex-direction:column;gap:1rem;flex:1;min-height:0;overflow:hidden;">
      <div style="display:flex;gap:1.2rem;align-items:flex-start;"><div style="width:6px;height:6px;border-radius:50%;background:var(--accent);margin-top:.7rem;flex-shrink:0;"></div><p style="font-size:1.3rem;line-height:1.5;">Key point with <strong style="color:var(--text);">bold emphasis</strong>.</p></div>
      <div style="display:flex;gap:1.2rem;align-items:flex-start;"><div style="width:6px;height:6px;border-radius:50%;background:var(--accent-2);margin-top:.7rem;flex-shrink:0;"></div><p style="font-size:1.3rem;line-height:1.5;">Another key point with details.</p></div>
      <div style="display:flex;gap:1.2rem;align-items:flex-start;"><div style="width:6px;height:6px;border-radius:50%;background:var(--accent);margin-top:.7rem;flex-shrink:0;"></div><p style="font-size:1.3rem;line-height:1.5;">Third point -- all content shown, just scaled to fit.</p></div>
    </div>
    <p style="font-size:1rem;color:var(--accent);opacity:.4;letter-spacing:.1em;text-transform:uppercase;margin-top:1rem;">Source - Year</p>
  </div>
</section>

LAYOUT PATTERN B -- IMAGE BESIDE CARDS (inside regular padded section):
<div style="flex:1;min-height:0;display:flex;gap:3rem;overflow:hidden;">
  <div class="img-slot" data-image-slot="2" data-image-keyword="technology"
       style="flex:0 0 360px;overflow:hidden;border-radius:12px;">
    <div class="img-bg1"></div><div class="img-bg2"></div>
  </div>
  <div style="flex:1;display:flex;flex-direction:column;gap:2rem;min-width:0;">
    <div class="card accent"><h3>Card title</h3><p>Card content</p></div>
    <div class="card"><h3>Card title</h3><p>Card content</p></div>
  </div>
</div>

LAYOUT PATTERN C -- FULL-BLEED BACKGROUND (for covers or transitions):
<section class="s" style="padding:4rem 5rem;position:relative;overflow:hidden;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;">
  <div class="img-slot" data-image-slot="[1-9]" data-image-keyword="[keyword]"
       style="position:absolute;inset:0;z-index:0;border-radius:0;">
    <!-- Use a dark overlay to ensure text is readable -->
    <div style="position:absolute;inset:0;background:rgba(0,0,0,0.6);z-index:1;pointer-events:none;"></div>
  </div>
  <div style="position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;">
    <div class="tag" style="color:var(--accent);">TAG</div>
    <h1 style="color:#FFFFFF;">Title text</h1>
  </div>
</section>

ICON SYSTEM -- MANDATORY ON CONCEPT/FEATURE/PILLAR SLIDES:
Lucide icons are injected by server. USAGE: <div class="icon-wrapper"><i data-lucide="brain"></i></div>
Place at TOP of each feature card, before h3 title. Alternate styles: .icon-wrapper (accent) or style="background:var(--accent-2-dim)".
USE EXACTLY the names from designJson.slides[N].icon_names -- do NOT substitute, invent, or rename them.
MANDATORY RULE: Every deck uses icons on >=2 slides. Every card (2+) with icons gets ICON on each.
Per slide: designJson.slides[N].icon_names specifies exact names. Size: 22px (already in CSS).

=======================================
EXAMPLE COVER IMPLEMENTATIONS
=======================================
BASIC: Grid + sidebar (see below) - POSTER-CENTER: Bold title centered, bars top+bottom - LABEL-STRIP: Vertical tag sidebar left

EXAMPLE 1: Grid + sidebar
<section class="s" style="padding:0;display:flex;position:relative;overflow:hidden;">
  <!-- decorative: grid using inline style so position:absolute works -->
  <div style="position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px);background-size:48px 48px;pointer-events:none;z-index:0;"></div>
  <!-- 4px accent sidebar -->
  <div style="position:absolute;left:0;top:0;width:4px;height:100%;background:linear-gradient(to bottom,var(--accent),var(--accent-2) 50%,transparent);z-index:0;"></div>
  <!-- content layer above decoratives -->
  <div style="flex:1;padding:4rem 5rem;display:flex;flex-direction:column;justify-content:space-between;position:relative;z-index:1;min-width:0;">
    <div class="tag">Technology - Advanced</div>
    <div style="flex:1;display:flex;flex-direction:column;justify-content:center;">
      <h1 style="font-size:8rem;line-height:.9;letter-spacing:-.03em;">Artificial</h1>
      <h1 style="font-size:8rem;line-height:.9;letter-spacing:-.03em;color:var(--accent);margin-bottom:2rem;">Intelligence</h1>
      <p style="font-size:1.4rem;max-width:55rem;line-height:1.65;">Foundations, architectures, and the real state of the field -- beyond the hype.</p>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:flex-end;">
      <p style="font-family:'JetBrains Mono',monospace;font-size:1.1rem;color:var(--accent-2);opacity:.3;letter-spacing:.1em;">model.load("reality.pt")</p>
      <p style="font-size:1.2rem;color:var(--text-dim);opacity:.5;">01 / 08</p>
    </div>
  </div>
</section>

OTHER VALID COVER DIRECTIONS -- DO NOT DEFAULT TO EXAMPLE 1:

Cover: poster-center -> section style="justify-content:center;align-items:center;text-align:center". Top+bottom color bars, centered h1 (7.2rem), subtitle below.
Example: Bold title + bars + centered tag. Use when: bold poster energy, high contrast.

Cover: label-strip -> flex with left sidebar (170px fixed). Vertical tag in sidebar, offset h1 right. Example: Archive timestamp left, large title right.
Use when: archival/documentary feel, side metadata important.

EXAMPLE: Stats slide -> flex row with 3 blocks, dividers between. Each block: big number (5-10rem) + label (1.3rem) + source (monospace, dim).
Use for: data-heavy slides where numbers dominate visual weight


=======================================
OUTPUT STRUCTURE (start with this exactly)
=======================================

<!-- CONFIG
${JSON.stringify({
  topic: contentJson.topic,
  language: contentJson.language,
  slide_count: contentJson.slide_count,
  tone: contentJson.tone,
  audience: contentJson.audience,
  colors_hex: colors,
  bg_hex: designJson.palette.bg_hex,
  bg_mode: designJson.palette.bg_mode,
  font_pair: designJson.font_pair,
  author: contentJson.author,
  teacher: contentJson.teacher,
  institution: contentJson.institution,
  subject: contentJson.subject
}, null, 2)}
-->
<!DOCTYPE html>
<html lang="${contentJson.language}">
<head><meta charset="UTF-8">
<style>
  [complete CSS: @import, :root vars, base styles, AND custom per-slide classes]
</style>
</head>
<body>
  [exactly ${contentJson.slide_count} <section class="s"> elements]
</body>
</html>

CRITICAL CHECKLIST:
Start: <!-- CONFIG
Exactly ${contentJson.slide_count} <section class="s">
designJson.slides[N].composition_literal -> literal code translation
All flex children: min-height:0
Overlays: inline style="position:absolute", never classed
designJson.slides[N].icon_names: <div class="icon-wrapper"><i data-lucide="name"></i></div>
Image slots: NEVER direct child of column-flex section (breaks sizing). If split: flex-direction:row inline
All content appears (never truncate -- scale fonts instead)
designJson+contentJson: translate faithfully, no creative changes on structure`;
};

