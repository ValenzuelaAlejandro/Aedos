function initTools(iframe) {
    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
    const iframeWin = iframe.contentWindow;
    const dynamicContainer = document.getElementById('dynamic-tools-container');
    const toolsPanel = document.getElementById('editor-tools-panel');

    // --- selection change state ---
    let selectionT = null;
    // Track which toolbar button opened the panel so only the same button closes it
    let panelOwner = null;
    // Guard: prevents selection-changed from clearing panelOwner when a btn triggered the select
    let _settingPanelOwner = false;

    iframeWin.addEventListener('selection-changed', (e) => {
        const el = e.detail.element;
        // Optimization: debounce UI re-renders for multi-clicks/restores
        clearTimeout(selectionT);
        selectionT = setTimeout(() => {
            if (!el) {
                // Deselection: just hide the panel, don't open bg tools
                panelOwner = null;
                if (toolsPanel) {
                    toolsPanel.classList.remove('active');
                }
                return;
            }
            // If this selection was triggered by a direct element click (not a btn),
            // clear panelOwner so the ownership resets
            if (!_settingPanelOwner) {
                panelOwner = null;
            }
            renderTools(el);
        }, 50);
    });

    // --- dynamic tools functions ---
    function fixToolsPanel() {
        if (!toolsPanel) return;
        toolsPanel.classList.remove('is-empty');
        toolsPanel.classList.add('is-fixed');
    }

    function safeAddListener(id, event, cb) {
        let node = document.getElementById(id);
        if (!node) return;
        const clone = node.cloneNode(true);
        node.replaceWith(clone);
        clone.addEventListener(event, cb);
    }

    function getActiveSlide() {
        const slides = Array.from(iframeDoc.querySelectorAll('section[class*="s"]'));
        return slides.find(s => s.classList.contains('active')) || slides[0] || iframeDoc.body;
    }

    function insertShape(className, styles) {
        if (iframeWin.editorSaveState) iframeWin.editorSaveState();
        const slide = getActiveSlide();
        const shape = iframeDoc.createElement('div');
        shape.className = className + ' shapes-added'; // identification
        shape.style.position = 'absolute';
        shape.style.left = '50%';
        shape.style.top = '50%';
        shape.style.transform = styles.includes('rotate') ? styles : 'translate(-50%, -50%)';
        shape.style.width = styles && styles.includes('999px') ? '240px' : '150px';
        shape.style.height = '150px';
        shape.style.backgroundColor = '#6366f1';
        shape.style.zIndex = '10';

        // Split styles and apply manually 
        if (styles) {
            const custom = styles.split(';').filter(s => s.trim());
            custom.forEach(s => {
                const parts = s.split(':');
                const prop = parts.shift();
                const val = parts.join(':');
                if (prop && val) {
                    shape.style.setProperty(prop.trim(), val.trim());
                }
            });
        }

        slide.appendChild(shape);

        // Select it automatically to show tools
        if (iframeWin.editorSelect) {
            iframeWin.editorSelect(shape);
        } else {
            // Fallback for older sessions
            const clickEv = new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: iframeWin });
            shape.dispatchEvent(clickEv);
            const upEv = new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: iframeWin });
            iframeDoc.dispatchEvent(upEv);
        }

        if (iframeWin.editorUpdateSelection) iframeWin.editorUpdateSelection();
    }

    function insertIcon(iconName) {
        if (iframeWin.editorSaveState) iframeWin.editorSaveState();
        const slide = getActiveSlide();
        const icon = iframeDoc.createElement('i');
        icon.setAttribute('data-lucide', iconName);
        icon.style.position = 'absolute';
        icon.style.left = '50%';
        icon.style.top = '50%';
        icon.style.transform = 'translate(-50%, -50%)';
        icon.style.width = '64px';
        icon.style.height = '64px';
        icon.style.color = '#eab308';
        icon.style.zIndex = '10';
        icon.classList.add('lucide-icon');
        slide.appendChild(icon);

        if (iframeWin.lucide) iframeWin.lucide.createIcons();

        // Select it automatically to show tools
        // After Lucide replaces the <i> with <svg>, find the actual element
        const newlyCreated = slide.querySelector(`[data-lucide="${iconName}"]`);
        const elToSelect = newlyCreated || icon;

        if (iframeWin.editorSelect) {
            iframeWin.editorSelect(elToSelect);
        } else {
            // Fallback
            const clickEv = new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: iframeWin });
            elToSelect.dispatchEvent(clickEv);
            const upEv = new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: iframeWin });
            iframeDoc.dispatchEvent(upEv);
        }

        if (iframeWin.editorUpdateSelection) iframeWin.editorUpdateSelection();
    }

    // Helper to generate right panel tools based on selected element
    function renderTools(el) {
        if (!toolsPanel) return;

        if (!el) {
            // Unselected state: show slide level tools but hide panel by default
            toolsPanel.classList.remove('active');
        } else {
            // Element selected: show property inspector
            toolsPanel.classList.add('active');
            toolsPanel.classList.remove('is-empty');
        }

        if (!el) {
            const reachedLimit = iframeDoc.querySelectorAll('section[class*="s"]').length >= 15;
            // Render Slide level tools
            dynamicContainer.innerHTML = `
                <div class="tool-section">
                    <div class="tool-section-title">${window.__t('slide')}</div>
                    <div class="tool-row">
                        <span class="tool-label">${window.__t('background_color')}</span>
                        <div class="color-picker-wrapper">
                            <input type="color" id="tool-bg-color" name="tool-bg-color" class="tool-input" style="padding:0; height:32px;">
                        </div>
                    </div>
                </div>

                <div class="tool-section" style="margin-top:0.5rem; border-top:1px solid var(--border); padding-top:1rem;">
                    <button id="tool-add-slide-alt" class="add-el-btn" ${reachedLimit ? 'disabled' : ''} style="width:100%; padding:0.8rem; border:1px dashed var(--border); flex-direction:row; gap:0.8rem; ${reachedLimit ? 'opacity:0.5; pointer-events:none;' : ''}">
                        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                        <span style="font-size: 0.85rem; font-weight:500;">${window.__t('add_slide', 'Add Slide')}</span>
                    </button>
                </div>
            `;

            const bgColorBtn = document.getElementById('tool-bg-color');
            if (bgColorBtn) {
                const slides = Array.from(iframeDoc.querySelectorAll('section[class*="s"]'));
                const activeSlide = slides.find(s => s.classList.contains('active')) || slides[0];
                if (activeSlide) {
                    const currentBg = iframeWin.getComputedStyle(activeSlide).backgroundColor;
                    const rgbToHex = (val) => {
                        if (!val) return null;
                        if (val.startsWith('#')) return val;
                        const match = val.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
                        if (match) {
                            const r = parseInt(match[1]).toString(16).padStart(2, '0');
                            const g = parseInt(match[2]).toString(16).padStart(2, '0');
                            const b = parseInt(match[3]).toString(16).padStart(2, '0');
                            return `#${r}${g}${b}`;
                        }
                        return null;
                    };
                    if (currentBg) {
                        bgColorBtn.value = rgbToHex(currentBg) || '#121212';
                    }

                    bgColorBtn.addEventListener('input', (e) => {
                        if (!activeSlide._undoSavingBg) {
                            if (iframeWin.editorSaveState) iframeWin.editorSaveState();
                            activeSlide._undoSavingBg = true;
                            setTimeout(() => activeSlide._undoSavingBg = false, 1000);
                        }
                        activeSlide.style.background = e.target.value;
                    });
                }

                const addSlideAlt = document.getElementById('tool-add-slide-alt');
                if (addSlideAlt) {
                    addSlideAlt.addEventListener('click', () => {
                        const originalBtn = document.getElementById('btn-add-slide');
                        if (originalBtn) originalBtn.click();
                    });
                }
            }
            return;
        }

        // --- Library Rendering ---
        if (el === 'lib-icons' || el === 'lib-shapes') {
            const isIcons = el === 'lib-icons';
            let html = `
                <div class="tool-section">
                    <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.5rem;">
                        <button id="lib-back-btn" class="tool-btn" style="width:32px; height:32px; border-radius:50%; flex:none;">←</button>
                        <div class="tool-section-title" style="margin:0;">${isIcons ? window.__t('select_icon') : window.__t('select_shape')}</div>
                    </div>
            `;

            if (isIcons) {
                const iconCategories = {
                    'essentials': ['star', 'heart', 'zap', 'smile', 'check-circle', 'alert-triangle', 'info', 'help-circle', 'home', 'settings', 'search', 'menu', 'plus', 'minus', 'x'],
                    'communication': ['mail', 'phone', 'message-square', 'send', 'share-2', 'globe', 'link', 'bell'],
                    'business': ['briefcase', 'credit-card', 'pie-chart', 'bar-chart-2', 'trending-up', 'calculator', 'dollar-sign', 'banknote', 'target', 'trophy'],
                    'multimedia': ['camera', 'image', 'video', 'music', 'clapperboard', 'play', 'pause', 'volume-2', 'headphones'],
                    'technology': ['clock', 'smartphone', 'laptop', 'tablet', 'monitor', 'hard-drive', 'cpu', 'database', 'wifi'],
                    'social': ['user', 'users', 'user-plus', 'user-check', 'thumbs-up', 'thumbs-down', 'laugh', 'ghost'],
                    'navigation': ['arrow-right', 'arrow-left', 'arrow-up', 'arrow-down', 'chevron-right', 'chevron-left', 'chevron-up', 'chevron-down', 'move', 'maximize', 'minimize'],
                    'nature': ['sun', 'moon', 'cloud', 'cloud-rain', 'cloud-lightning', 'wind', 'leaf', 'tree-pine', 'flame', 'anchor', 'rocket', 'map-pin'],
                    'objects': ['gift', 'shopping-cart', 'coffee', 'crown', 'flag', 'lock', 'unlock', 'key', 'pen-tool', 'pencil', 'trash-2', 'eye', 'eye-off', 'lightbulb']
                };

                Object.entries(iconCategories).forEach(([name, icons], idx) => {
                    html += `
                        <details class="lib-category" ${idx === 0 ? 'open' : ''}>
                            <summary class="lib-category-summary">${window.__t(name)}</summary>
                            <div class="lib-grid">
                    `;
                    icons.forEach(icon => {
                        html += `<div class="lib-item" data-type="icon" data-val="${icon}"><i data-lucide="${icon}"></i></div>`;
                    });
                    html += `</div></details>`;
                });
            } else {
                html += `<div class="lib-grid">`;
                const shapes = [
                    { name: 'square', class: 'card', styles: '' },
                    { name: 'circle', class: 'card', styles: 'border-radius: 50%;' },
                    { name: 'diamond', class: 'card', styles: 'clip-path: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);' },
                    { name: 'triangle', class: 'card', styles: 'clip-path: polygon(50% 0%, 0% 100%, 100% 100%);' },
                    { name: 'hexagon', class: 'card', styles: 'clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%);' },
                    { name: 'capsule', class: 'card', styles: 'border-radius: 999px;' }
                ];
                shapes.forEach(shape => {
                    html += `
                        <div class="lib-item shape-preview" style="overflow: visible;" data-type="shape" data-class="${shape.class}" data-styles="${shape.styles}">
                            <div style="width:${shape.name === 'capsule' ? '36px' : '24px'}; height:24px; background:currentColor; border:none; ${shape.styles}"></div>
                        </div>`;
                });
                html += `</div>`;
            }

            html += `</div>`;

            dynamicContainer.innerHTML = html;

            // Re-enable block to prevent background slide move while scrolling icons
            dynamicContainer.onwheel = (e) => {
                e.stopPropagation();
            };
            // Bind Library Actions
            document.getElementById('lib-back-btn').addEventListener('click', () => renderTools(null));

            dynamicContainer.querySelectorAll('.lib-item').forEach(item => {
                item.addEventListener('click', () => {
                    const type = item.dataset.type;
                    if (type === 'icon') {
                        insertIcon(item.dataset.val);
                    } else if (type === 'shape') {
                        insertShape(item.dataset.class, item.dataset.styles);
                    }
                    // Removed renderTools(null) as the new selection will trigger its own tools
                });
            });

            if (window.lucide) window.lucide.createIcons({
                attrs: { width: 20, height: 20 }
            });
            return;
        }

        if (typeof el === 'string') return; // Already handled libraries or other strings

        const tagName = el.tagName ? el.tagName.toLowerCase() : '';
        if (!tagName) return;
        const isText = ['h1', 'h2', 'h3', 'h4', 'p', 'span', 'li', 'blockquote'].includes(tagName) || 
                       el.classList.contains('tag') || 
                       el.classList.contains('big-number') || 
                       el.classList.contains('big-label') || 
                       el.classList.contains('subtitle') || 
                       el.classList.contains('step-num') || 
                       el.classList.contains('timeline-year');
        const isImage = tagName === 'img' || el.classList.contains('img-slot') || el.hasAttribute('data-image-slot');
        // Shapes can be SVG or Divs with .card class
        const isShape = (tagName === 'svg' && !el.hasAttribute('data-lucide') && !isImage) ||
            (el.classList.contains('card') && !isText && !isImage);
        const isIcon = el.hasAttribute('data-lucide') || el.classList.contains('lucide') || tagName === 'i' || tagName === 'svg';

        let html = '';

        const FONT_LIST = [
            { label: 'Core', fonts: [
                { name: 'Syne (Display)', value: "'Syne', sans-serif" },
                { name: 'DM Sans (Body)',  value: "'DM Sans', sans-serif" },
            ]},
            { label: 'Sans Serif', fonts: [
                { name: 'Inter',               value: "'Inter', sans-serif" },
                { name: 'Montserrat',          value: "'Montserrat', sans-serif" },
                { name: 'Outfit',              value: "'Outfit', sans-serif" },
                { name: 'Plus Jakarta Sans',   value: "'Plus Jakarta Sans', sans-serif" },
                { name: 'Sora',               value: "'Sora', sans-serif" },
                { name: 'Space Grotesque',    value: "'Space Grotesque', sans-serif" },
                { name: 'Lexend',             value: "'Lexend', sans-serif" },
                { name: 'Prompt',             value: "'Prompt', sans-serif" },
                { name: 'Ubuntu',             value: "'Ubuntu', sans-serif" },
                { name: 'Bricolage Grotesque',value: "'Bricolage Grotesque', sans-serif" },
            ]},
            { label: 'Serif', fonts: [
                { name: 'Playfair Display',   value: "'Playfair Display', serif" },
                { name: 'Lora',              value: "'Lora', serif" },
                { name: 'Fraunces',          value: "'Fraunces', serif" },
                { name: 'Cormorant Garamond',value: "'Cormorant Garamond', serif" },
                { name: 'Bitter',            value: "'Bitter', serif" },
                { name: 'Cinzel',            value: "'Cinzel', serif" },
            ]},
            { label: 'Display & Mono', fonts: [
                { name: 'Bebas Neue',        value: "'Bebas Neue', cursive" },
                { name: 'Archivo Black',     value: "'Archivo Black', sans-serif" },
                { name: 'Unbounded',         value: "'Unbounded', cursive" },
                { name: 'JetBrains Mono',    value: "'JetBrains Mono', monospace" },
            ]},
            { label: 'System', fonts: [
                { name: 'Arial',             value: 'Arial, sans-serif' },
                { name: 'Times New Roman',   value: "'Times New Roman', serif" },
                { name: 'Georgia',           value: 'Georgia, serif' },
                { name: 'Verdana',           value: 'Verdana, sans-serif' },
                { name: 'Trebuchet MS',      value: "'Trebuchet MS', sans-serif" },
                { name: 'Courier New',       value: "'Courier New', monospace" },
            ]},
        ];

        if (isText) {
            let fontPickerOptions = '';
            FONT_LIST.forEach(group => {
                fontPickerOptions += `<div class="fpicker-group-label">${group.label}</div>`;
                group.fonts.forEach(f => {
                    fontPickerOptions += `<div class="fpicker-option" data-value="${f.value}" style="font-family:${f.value}">${f.name}</div>`;
                });
            });

            html += `
                <div class="tool-section">
                    <div class="tool-section-title">${window.__t('text_tool')}</div>
                    <div class="tool-row">
                        <div class="fpicker" id="tool-font-picker">
                            <div class="fpicker-trigger" id="tool-font-trigger">
                                <span class="fpicker-current" id="tool-font-label">${window.__t('select_font', 'Select font')}</span>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
                            </div>
                            <div class="fpicker-dropdown" id="tool-font-dropdown">
                                ${fontPickerOptions}
                            </div>
                        </div>
                    </div>
                    <div class="tool-row">
                        <span class="tool-label">${window.__t('size')}</span>
                        <div class="tool-btn-group" style="width: auto;">
                            <button id="tool-font-min" class="tool-btn">-</button>
                            <input type="number" id="tool-font-size" name="tool-font-size" class="tool-input" value="16" style="border:none !important; border-radius:0 !important; flex:1;">
                            <button id="tool-font-add" class="tool-btn">+</button>
                        </div>
                    </div>
                    <div class="tool-row">
                        <div class="tool-btn-group">
                            <button id="tool-bold" class="tool-btn"><b>B</b></button>
                            <button id="tool-italic" class="tool-btn"><i>I</i></button>
                            <button id="tool-under" class="tool-btn"><u>U</u></button>
                        </div>
                    </div>
                    <div class="tool-row">
                        <span class="tool-label">${window.__t('alignment')}</span>
                        <div class="tool-btn-group">
                            <button id="tool-align-l" class="tool-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="12" x2="15" y2="12"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg></button>
                            <button id="tool-align-c" class="tool-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="7" y1="12" x2="17" y2="12"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg></button>
                            <button id="tool-align-r" class="tool-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="9" y1="12" x2="21" y2="12"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg></button>
                        </div>
                    </div>
                    <div class="tool-row">
                        <span class="tool-label">${window.__t('color')}</span>
                        <div class="color-picker-wrapper">
                            <input type="color" id="tool-color" name="tool-text-color" class="tool-input" style="padding:0; height:32px;">
                        </div>
                    </div>
                </div>
            `;
        }

        if (isImage) {
            html += `
                <div class="tool-section">
                    <div class="tool-section-title">${window.__t('image_tool')}</div>
                    <div class="tool-row">
                        <button id="tool-replace-img" class="add-el-btn" style="width:100%; padding:0.5rem;">${window.__t('replace_image')}</button>
                    </div>
                    <div class="tool-row">
                        <span class="tool-label">${window.__t('border_radius')}</span>
                        <div class="tool-slider-row" style="flex:1; margin-left: 1rem;">
                            <input type="range" id="tool-radius" name="tool-radius" class="tool-slider" min="0" max="100" value="0">
                        </div>
                    </div>
                    <div class="tool-row">
                        <span class="tool-label">${window.__t('opacity')}</span>
                        <div class="tool-slider-row" style="flex:1; margin-left: 1rem;">
                            <input type="range" id="tool-opacity" name="tool-opacity" class="tool-slider" min="0" max="100" value="100">
                        </div>
                    </div>
                </div>
            `;
        }

        if (isIcon) {
            html += `
                <div class="tool-section">
                    <div class="tool-section-title">${window.__t('icon_tool')}</div>
                    <div class="tool-row">
                        <span class="tool-label">${window.__t('icon_color')}</span>
                        <div class="color-picker-wrapper">
                            <input type="color" id="tool-color" name="tool-icon-color" class="tool-input" style="padding:0; height:32px;">
                        </div>
                    </div>
                    <div class="tool-row">
                        <span class="tool-label">${window.__t('size')}</span>
                        <div class="tool-slider-row" style="flex:1; margin-left: 1rem;">
                            <input type="range" id="tool-icon-size" name="tool-icon-size" class="tool-slider" min="12" max="256" value="${parseInt(el.style.width) || 48}">
                        </div>
                    </div>
                </div>
            `;
        }

        if (isShape && !isIcon) {
            html += `
                <div class="tool-section">
                    <div class="tool-section-title">${window.__t('shape_tool')}</div>
                    <div class="tool-row">
                        <span class="tool-label">${window.__t('fill_color')}</span>
                        <div class="color-picker-wrapper">
                            <input type="color" id="tool-fill" name="tool-fill-color" class="tool-input" style="padding:0; height:32px;">
                        </div>
                    </div>
                    <div class="tool-row">
                        <span class="tool-label">${window.__t('border_color')}</span>
                        <div class="color-picker-wrapper">
                            <input type="color" id="tool-stroke" name="tool-stroke-color" class="tool-input" style="padding:0; height:32px;">
                        </div>
                    </div>
                    <div class="tool-row">
                        <span class="tool-label">${window.__t('opacity')}</span>
                        <div class="tool-slider-row" style="flex:1; margin-left: 1rem;">
                            <input type="range" id="tool-opacity" name="tool-shape-opacity" class="tool-slider" min="0" max="100" value="100">
                        </div>
                    </div>
                </div>
            `;
        }

        // Universal tools (Shadow, Delete, Z-index)
        html += `
            <div class="tool-section" style="margin-top: 1rem;">
                <div class="tool-section-title">${window.__t('advanced')}</div>
                <div class="tool-row" style="display:flex; gap:0.5rem; margin-bottom: 0.5rem;">
                    <button id="tool-layer-up" class="add-el-btn" style="flex:1; padding:0.5rem; font-size: 0.75rem; font-weight: 600;">
                        ${window.__t('bring_to_front')}
                    </button>
                    <button id="tool-layer-down" class="add-el-btn" style="flex:1; padding:0.5rem; font-size: 0.75rem; font-weight: 600;">
                        ${window.__t('send_to_back')}
                    </button>
                </div>
                <div class="tool-row">
                    <button id="tool-delete" class="add-el-btn" style="width:100%; padding:0.5rem; color:#ff5b5b; border-color:rgba(255,91,91,0.3);">${window.__t('delete_element')}</button>
                </div>
            </div>
        `;

        dynamicContainer.innerHTML = html;

        // --- Bind Events ---
        if (isText) {
            const fontSize = document.getElementById('tool-font-size');
            const fontAdd = document.getElementById('tool-font-add');
            const fontMin = document.getElementById('tool-font-min');
            const bold = document.getElementById('tool-bold');
            const italic = document.getElementById('tool-italic');
            const under = document.getElementById('tool-under');
            const color = document.getElementById('tool-color');
            const alignL = document.getElementById('tool-align-l');
            const alignC = document.getElementById('tool-align-c');
            const alignR = document.getElementById('tool-align-r');

            const rgbToHex = (val) => {
                if (!val || val === 'transparent' || val.includes('rgba(0, 0, 0, 0)')) return '#000000';
                if (val.startsWith('#')) return val;
                const match = val.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d+(?:\.\d+)?))?\)$/);
                if (match) {
                    const r = parseInt(match[1]).toString(16).padStart(2, '0');
                    const g = parseInt(match[2]).toString(16).padStart(2, '0');
                    const b = parseInt(match[3]).toString(16).padStart(2, '0');
                    return `#${r}${g}${b}`;
                }
                return '#000000';
            };

            // Init values
            const comp = iframeWin.getComputedStyle(el);
            if (color) color.value = rgbToHex(comp.color);
            fontSize.value = parseInt(comp.fontSize);
            if (comp.fontWeight > 400 || comp.fontWeight === 'bold') bold.classList.add('active');
            if (comp.fontStyle === 'italic') italic.classList.add('active');
            if (comp.textDecoration.includes('underline')) under.classList.add('active');

            // --- Custom font picker logic ---
            const picker     = document.getElementById('tool-font-picker');
            const trigger    = document.getElementById('tool-font-trigger');
            const dropdown   = document.getElementById('tool-font-dropdown');
            const labelEl    = document.getElementById('tool-font-label');

            const activeSlide = Array.from(iframeDoc.querySelectorAll('section')).find(s => s.classList.contains('active'));
            if (activeSlide) {
                const accentColor = iframeWin.getComputedStyle(activeSlide).getPropertyValue('--accent').trim();
                if (accentColor) picker.style.setProperty('--fpicker-accent', accentColor);
            }

            const currentFF = comp.fontFamily;
            FONT_LIST.forEach(g => g.fonts.forEach(f => {
                if (currentFF.includes(f.value.split(',')[0].replace(/'/g, '').trim())) {
                    labelEl.textContent = f.name;
                    labelEl.style.fontFamily = f.value;
                }
            }));

            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = picker.classList.toggle('open');
                if (isOpen) {
                    const close = (ev) => {
                        if (!picker.contains(ev.target)) {
                            picker.classList.remove('open');
                            document.removeEventListener('click', close);
                        }
                    };
                    document.addEventListener('click', close);
                }
            });

            dropdown.querySelectorAll('.fpicker-option').forEach(opt => {
                opt.addEventListener('click', () => {
                    const val = opt.dataset.value;
                    if (iframeWin.editorSaveState) iframeWin.editorSaveState();
                    el.style.setProperty('font-family', val, 'important');
                    labelEl.textContent = opt.textContent;
                    labelEl.style.fontFamily = val;
                    picker.classList.remove('open');
                });
            });

            dropdown.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });

            const updateSize = (val) => {
                if (iframeWin.editorSaveState) iframeWin.editorSaveState();
                el.style.fontSize = val + 'px';
                fontSize.value = val;
            };

            fontAdd.addEventListener('click', () => {
                updateSize(parseInt(fontSize.value) + 1);
                if (iframeWin.editorUpdateSelection) iframeWin.editorUpdateSelection();
            });
            fontMin.addEventListener('click', () => {
                updateSize(parseInt(fontSize.value) - 1);
                if (iframeWin.editorUpdateSelection) iframeWin.editorUpdateSelection();
            });
            fontSize.addEventListener('change', (e) => {
                updateSize(e.target.value);
                if (iframeWin.editorUpdateSelection) iframeWin.editorUpdateSelection();
            });

            bold.addEventListener('click', () => {
                if (iframeWin.editorSaveState) iframeWin.editorSaveState();
                const isBold = el.style.fontWeight === 'bold';
                el.style.fontWeight = isBold ? 'normal' : 'bold';
                bold.classList.toggle('active', !isBold);
            });
            italic.addEventListener('click', () => {
                if (iframeWin.editorSaveState) iframeWin.editorSaveState();
                const isIt = el.style.fontStyle === 'italic';
                el.style.fontStyle = isIt ? 'normal' : 'italic';
                italic.classList.toggle('active', !isIt);
            });
            under.addEventListener('click', () => {
                if (iframeWin.editorSaveState) iframeWin.editorSaveState();
                const isU = el.style.textDecoration === 'underline';
                el.style.textDecoration = isU ? 'none' : 'underline';
                under.classList.toggle('active', !isU);
            });

            const setAlign = (val, btn) => {
                if (iframeWin.editorSaveState) iframeWin.editorSaveState();
                el.style.textAlign = val;
                [alignL, alignC, alignR].forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            };
            alignL.addEventListener('click', () => setAlign('left', alignL));
            alignC.addEventListener('click', () => setAlign('center', alignC));
            alignR.addEventListener('click', () => setAlign('right', alignR));

            const colorSaving = (e) => {
                if (!el._colorSaving) {
                    if (iframeWin.editorSaveState) iframeWin.editorSaveState();
                    el._colorSaving = true;
                    setTimeout(() => el._colorSaving = false, 1000);
                }
                el.style.color = e.target.value;
                el.style.webkitTextFillColor = e.target.value;
                if (iframeWin.editorUpdateSelection) iframeWin.editorUpdateSelection();
            };
            color.addEventListener('input', colorSaving);
        }

        if (isImage) {
            const btnReplace = document.getElementById('tool-replace-img');
            const radius = document.getElementById('tool-radius');
            const opacity = document.getElementById('tool-opacity');
            const comp = iframeWin.getComputedStyle(el);

            if (radius) {
                radius.value = String(Math.round(parseFloat(comp.borderTopLeftRadius) || 0));
            }
            if (opacity) {
                const currentOpacity = parseFloat(comp.opacity);
                opacity.value = String(Math.round((Number.isFinite(currentOpacity) ? currentOpacity : 1) * 100));
            }

            btnReplace.addEventListener('click', () => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'image/*';
                input.onchange = (e) => {
                    const file = e.target.files[0];
                    if (file) {
                        window.gifToStaticDataUrl(file).then((dataUrl) => {
                            if (iframeWin.editorSaveState) iframeWin.editorSaveState();
                            if (el.tagName === 'IMG') {
                                el.src = dataUrl;
                            } else {
                                el.style.backgroundImage = `url('${dataUrl}')`;
                                el.style.backgroundSize = 'cover';
                                el.style.backgroundPosition = 'center';
                                el.style.backgroundRepeat = 'no-repeat';
                                el.classList.add('has-custom-image');
                                const placeholderLayers = Array.from(el.querySelectorAll(':scope > .img-bg1, :scope > .img-bg2'));
                                placeholderLayers.forEach(layer => layer.style.display = 'none');
                            }
                        });
                    }
                };
                input.click();
            });

            radius.addEventListener('input', (e) => {
                if (!el._undoSavingRadius) {
                    if (iframeWin.editorSaveState) iframeWin.editorSaveState();
                    el._undoSavingRadius = true;
                    setTimeout(() => el._undoSavingRadius = false, 1000);
                }
                el.style.borderRadius = e.target.value + 'px';
                if (iframeWin.editorUpdateSelection) iframeWin.editorUpdateSelection();
            });
            opacity.addEventListener('input', (e) => {
                if (!el._undoSavingOpacity) {
                    if (iframeWin.editorSaveState) iframeWin.editorSaveState();
                    el._undoSavingOpacity = true;
                    setTimeout(() => el._undoSavingOpacity = false, 1000);
                }
                el.style.opacity = e.target.value / 100;
                if (iframeWin.editorUpdateSelection) iframeWin.editorUpdateSelection();
            });
        }

        if (isShape && !isIcon) {
            const fill = document.getElementById('tool-fill');
            const stroke = document.getElementById('tool-stroke');
            const opacity = document.getElementById('tool-opacity');

            const rgbToHex = (val) => {
                if (!val || val === 'transparent' || val.includes('rgba(0, 0, 0, 0)')) return '#6366f1';
                if (val.startsWith('#')) return val;
                const match = val.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d+(?:\.\d+)?))?\)$/);
                if (match) {
                    const r = parseInt(match[1]).toString(16).padStart(2, '0');
                    const g = parseInt(match[2]).toString(16).padStart(2, '0');
                    const b = parseInt(match[3]).toString(16).padStart(2, '0');
                    return `#${r}${g}${b}`;
                }
                return '#6366f1';
            };

            const comp = iframeWin.getComputedStyle(el);
            if (fill) {
                fill.value = rgbToHex(comp.backgroundColor);
                fill.addEventListener('input', (e) => {
                    if (!el._undoSavingFill) {
                        if (iframeWin.editorSaveState) iframeWin.editorSaveState();
                        el._undoSavingFill = true;
                        setTimeout(() => el._undoSavingFill = false, 1000);
                    }
                    el.style.backgroundColor = e.target.value;
                });
            }
            if (stroke) {
                stroke.value = rgbToHex(comp.borderColor);
                stroke.addEventListener('input', (e) => {
                    if (!el._undoSavingStroke) {
                        if (iframeWin.editorSaveState) iframeWin.editorSaveState();
                        el._undoSavingStroke = true;
                        setTimeout(() => el._undoSavingStroke = false, 1000);
                    }
                    el.style.borderColor = e.target.value;
                });
            }
            if (opacity) {
                opacity.addEventListener('input', (e) => {
                    if (!el._undoSavingOpacity) {
                        if (iframeWin.editorSaveState) iframeWin.editorSaveState();
                        el._undoSavingOpacity = true;
                        setTimeout(() => el._undoSavingOpacity = false, 1000);
                    }
                    el.style.opacity = e.target.value / 100;
                });
            }
        }

        if (isIcon) {
            const iconColor = document.getElementById('tool-color');
            const iconSize = document.getElementById('tool-icon-size');
            const rgbToHex = (val) => {
                if (!val || val === 'transparent' || val.includes('rgba(0, 0, 0, 0)')) return '#eab308';
                if (val.startsWith('#')) return val;
                const match = val.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d+(?:\.\d+)?))?\)$/);
                if (match) {
                    const r = parseInt(match[1]).toString(16).padStart(2, '0');
                    const g = parseInt(match[2]).toString(16).padStart(2, '0');
                    const b = parseInt(match[3]).toString(16).padStart(2, '0');
                    return `#${r}${g}${b}`;
                }
                return '#eab308';
            };
            const comp = iframeWin.getComputedStyle(el);
            iconColor.value = rgbToHex(comp.color);
            iconColor.addEventListener('input', (e) => {
                if (!el._undoSavingColor) {
                    if (iframeWin.editorSaveState) iframeWin.editorSaveState();
                    el._undoSavingColor = true;
                    setTimeout(() => el._undoSavingColor = false, 1000);
                }
                el.style.color = e.target.value;
            });
            iconSize.addEventListener('input', (e) => {
                if (!el._undoSavingSize) {
                    if (iframeWin.editorSaveState) iframeWin.editorSaveState();
                    el._undoSavingSize = true;
                    setTimeout(() => el._undoSavingSize = false, 1000);
                }
                const val = e.target.value + 'px';
                el.style.width = val;
                el.style.height = val;
                if (iframeWin.editorUpdateSelection) iframeWin.editorUpdateSelection();
            });
        }

        const layerUp = document.getElementById('tool-layer-up');
        const layerDown = document.getElementById('tool-layer-down');
        if (layerUp) layerUp.addEventListener('click', () => iframeWin.toFront && iframeWin.toFront());
        if (layerDown) layerDown.addEventListener('click', () => iframeWin.toBack && iframeWin.toBack());

        const deleteBtn = document.getElementById('tool-delete');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                if (iframeWin.editorSaveState) iframeWin.editorSaveState();
                el.remove();
                if (iframeWin.editorDeselect) iframeWin.editorDeselect();
            });
        }
    }

    // --- background click to collapse ---
    iframeDoc.addEventListener('click', (e) => {
        const selectors = iframeWin.editableSelectors || 'h1, h2, h3, h4, p, span, li, blockquote, div.card, div.stat-box, div.step-item, div.timeline-item, .img-slot, .tag, .lucide-icon, svg[data-lucide], .big-number, .big-label, .accent-bar, .subtitle, .step-num, .timeline-year, [class*="card"], [class*="box"], [class*="item"]';
        const isEditable = e.target.closest(selectors);
        const isTool = e.target.closest('.editor-selection-box') || e.target.closest('.editor-toolbar') || e.target.closest('.editor-color-picker');

        if (!isEditable && !isTool) {
            const isJustSelected = iframeWin.isJustSelected && iframeWin.isJustSelected();
            const isDragging = iframeWin.editorIsDragging && iframeWin.editorIsDragging();
            if (isJustSelected || isDragging) return;

            // Just hide the panel on bg click — never open bg tools from here
            clearTimeout(selectionT);
            selectionT = null;
            panelOwner = null;
            toolsPanel.classList.remove('active');
            toolsPanel.classList.remove('is-fixed');
            if (iframeWin.editorDeselect) iframeWin.editorDeselect();
        }
    });

    // --- Add Elements listeners ---
    safeAddListener('btn-add-text', 'click', () => {
        const btnId = 'btn-add-text';
        if (toolsPanel && toolsPanel.classList.contains('active') && panelOwner === btnId) {
            clearTimeout(selectionT);
            selectionT = null;
            panelOwner = null;
            toolsPanel.classList.remove('active');
            toolsPanel.classList.remove('is-fixed');
            if (iframeWin.editorDeselect) iframeWin.editorDeselect();
            return;
        }
        // Mark that the upcoming selection-changed was triggered by this btn
        _settingPanelOwner = true;
        panelOwner = btnId;
        setTimeout(() => { _settingPanelOwner = false; }, 0);
        fixToolsPanel();
        if (iframeWin.editorSaveState) iframeWin.editorSaveState();
        const slide = getActiveSlide();
        const text = iframeDoc.createElement('h2');
        text.textContent = 'Nuevo Texto';
        text.style.position = 'absolute';
        text.style.left = '50%';
        text.style.top = '50%';
        text.style.transform = 'translate(-50%, -50%)';
        text.style.zIndex = '10';
        text.style.color = '#ffffff';
        text.style.margin = '0';
        text.style.fontFamily = 'Arial, sans-serif';
        text.style.fontSize = '12px';
        slide.appendChild(text);
        if (iframeWin.editorSelect) {
            iframeWin.editorSelect(text);
        } else {
            const clickEv = new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: iframeWin });
            text.dispatchEvent(clickEv);
            const upEv = new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: iframeWin });
            iframeDoc.dispatchEvent(upEv);
        }
    });

    safeAddListener('btn-add-image', 'click', () => {
        const btnId = 'btn-add-image';
        if (toolsPanel && toolsPanel.classList.contains('active') && panelOwner === btnId) {
            clearTimeout(selectionT);
            selectionT = null;
            panelOwner = null;
            toolsPanel.classList.remove('active');
            toolsPanel.classList.remove('is-fixed');
            if (iframeWin.editorDeselect) iframeWin.editorDeselect();
            return;
        }
        // Mark that the upcoming selection-changed was triggered by this btn
        _settingPanelOwner = true;
        panelOwner = btnId;
        setTimeout(() => { _settingPanelOwner = false; }, 0);
        fixToolsPanel();
        if (iframeWin.editorSaveState) iframeWin.editorSaveState();
        const slide = getActiveSlide();
        const img = iframeDoc.createElement('div');
        img.className = 'img-slot has-custom-image';
        img.style.position = 'absolute';
        img.style.left = '50%';
        img.style.top = '50%';
        img.style.transform = 'translate(-50%, -50%)';
        img.style.width = '300px';
        img.style.height = '200px';
        img.style.backgroundColor = 'rgba(255,255,255,0.1)';
        img.style.border = '2px dashed rgba(255,255,255,0.3)';
        img.style.borderRadius = '8px';
        img.style.zIndex = '10';
        img.dataset.imageSlot = 'manual-' + Date.now();
        slide.appendChild(img);

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                window.gifToStaticDataUrl(file).then((dataUrl) => {
                    img.style.backgroundImage = `url('${dataUrl}')`;
                    img.style.backgroundSize = 'cover';
                    img.style.border = 'none';
                });
            }
        };
        input.click();

        if (iframeWin.editorSelect) {
            iframeWin.editorSelect(img);
        } else {
            const clickEv = new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: iframeWin });
            img.dispatchEvent(clickEv);
            const upEv = new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: iframeWin });
            iframeDoc.dispatchEvent(upEv);
        }
    });

    safeAddListener('btn-add-shape', 'click', () => {
        const btnId = 'btn-add-shape';
        if (toolsPanel && toolsPanel.classList.contains('active') && panelOwner === btnId) {
            clearTimeout(selectionT);
            selectionT = null;
            panelOwner = null;
            toolsPanel.classList.remove('active');
            toolsPanel.classList.remove('is-fixed');
            return;
        }
        panelOwner = btnId;
        fixToolsPanel();
        renderTools('lib-shapes');
    });

    safeAddListener('btn-add-icon', 'click', () => {
        const btnId = 'btn-add-icon';
        if (toolsPanel && toolsPanel.classList.contains('active') && panelOwner === btnId) {
            clearTimeout(selectionT);
            selectionT = null;
            panelOwner = null;
            toolsPanel.classList.remove('active');
            toolsPanel.classList.remove('is-fixed');
            return;
        }
        panelOwner = btnId;
        fixToolsPanel();
        renderTools('lib-icons');
    });

    safeAddListener('btn-edit-background', 'click', () => {
        const btnId = 'btn-edit-background';
        if (toolsPanel && toolsPanel.classList.contains('active') && panelOwner === btnId) {
            clearTimeout(selectionT);
            selectionT = null;
            panelOwner = null;
            toolsPanel.classList.remove('active');
            toolsPanel.classList.remove('is-fixed');
            return;
        }
        panelOwner = btnId;
        fixToolsPanel();
        renderTools(null);
        if (toolsPanel) toolsPanel.classList.add('active');
    });

    // --- drop images handler ---
    const addImageAtHandler = (e) => {
        const { file, x, y } = e.detail;
        if (!file) return;
        fixToolsPanel();
        if (iframeWin.editorSaveState) iframeWin.editorSaveState();
        const slide = getActiveSlide();
        const slideRect = slide.getBoundingClientRect();
        const img = iframeDoc.createElement('div');
        img.className = 'img-slot has-custom-image';
        img.style.position = 'absolute';
        img.style.left = (x - slideRect.left) + 'px';
        img.style.top = (y - slideRect.top) + 'px';
        img.style.transform = 'translate(-50%, -50%)';
        img.style.width = '300px';
        img.style.height = '200px';
        img.style.backgroundColor = 'rgba(255,255,255,0.1)';
        img.style.border = '2px dashed rgba(255,255,255,0.3)';
        img.style.borderRadius = '8px';
        img.style.zIndex = '10';
        img.dataset.imageSlot = 'manual-' + Date.now();
        slide.appendChild(img);
        window.gifToStaticDataUrl(file).then((dataUrl) => {
            img.style.backgroundImage = `url('${dataUrl}')`;
            img.style.backgroundSize = 'cover';
            img.style.border = 'none';
        });
        if (window.parent && window.parent._buildOverlayForSlot) window.parent._buildOverlayForSlot(img);
        window.parent.dispatchEvent(new CustomEvent('drop-complete'));
        setTimeout(() => window.parent && window.parent._refreshSlotOverlays && window.parent._refreshSlotOverlays(), 50);
        if (iframeWin.editorSelect) iframeWin.editorSelect(img);
    };

    if (window._addImageHandler) window.removeEventListener('add-image-at', window._addImageHandler);
    window._addImageHandler = addImageAtHandler;
    window.addEventListener('add-image-at', window._addImageHandler);

    // Initial render
    renderTools(null);
}
window.initTools = initTools;
