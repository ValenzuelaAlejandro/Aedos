// Outline Editor Logic

window.outlineEditorState = {
    skeleton: null,
    mode: 'flash',
    maxSlides: 15,
    isLoading: false
};

function scrollToBottom(force = false) {
    const chatScreen = document.getElementById('chat-screen');
    if (!chatScreen) return;

    const threshold = 180;
    const isAtBottom = (chatScreen.scrollHeight - chatScreen.scrollTop - chatScreen.clientHeight) <= threshold;

    if (force || isAtBottom) {
        chatScreen.scrollTo({
            top: chatScreen.scrollHeight,
            behavior: 'auto'
        });
    }
}

function showOutlineEditorLoading(slideCount = 8) {
    window.outlineEditorState.isLoading = true;

    // Block language dropdown and enable stop action on send button
    const btnGenerate = document.getElementById('btn-generate');
    const btnLang = document.getElementById('btn-lang-dropdown');
    if (btnGenerate) {
        btnGenerate.classList.add('is-generating');
        btnGenerate.disabled = false;
    }
    if (btnLang) btnLang.disabled = true;

    // 1. Capture the prompt text before clearing
    const inputEl = document.getElementById('w-tema');
    const promptText = inputEl?.value?.trim() || '';
    if (inputEl) inputEl.value = '';

    // 2. Activate chat-mode on #chat-screen (aligns to top)
    const chatScreen = document.getElementById('chat-screen');
    if (chatScreen) chatScreen.classList.add('chat-mode');

    // 3. Fade out hero title
    const heroZone = document.getElementById('hero-zone');
    if (heroZone) heroZone.classList.add('fade-out');

    // 4. Fade out suggestion pills and microcopy
    const pills = document.getElementById('suggestion-pills-row');
    if (pills) { pills.style.transition = 'opacity 0.3s'; pills.style.opacity = '0'; pills.style.pointerEvents = 'none'; }
    const microcopy = document.querySelector('.app-microcopy');
    if (microcopy) { microcopy.style.transition = 'opacity 0.3s'; microcopy.style.opacity = '0'; }
    const counter = document.querySelector('.chat-counter-row');
    if (counter) { counter.style.transition = 'opacity 0.3s'; counter.style.opacity = '0'; }

    // 5. Show conversation zone with user bubble
    const convZone = document.getElementById('conversation-zone');
    if (convZone) {
        convZone.classList.remove('hidden');
        convZone.classList.add('visible');

        // Check if this is a follow-up (i.e. we already have an active skeleton)
        const isFollowUp = !!window.outlineEditorState.skeleton;

        if (isFollowUp) {
            // Append new user message bubble
            const userBubble = document.createElement('div');
            userBubble.className = 'chat-msg chat-msg-user';
            userBubble.innerHTML = `<span>${escapeHtml(promptText)}</span>`;
            convZone.appendChild(userBubble);

            // GSAP premium entrance animation
            if (window.gsap) {
                window.gsap.fromTo(userBubble, { opacity: 0, y: 15 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' });
            }

            // Append new AI message bubble with active loader
            const aiBubble = document.createElement('div');
            aiBubble.className = 'chat-msg chat-msg-ai';
            aiBubble.innerHTML = `
                <div class="chat-ai-avatar">
                    <svg viewBox="0 0 100 100" width="14" height="14" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M50,15 L80,75 L50,60 L20,75 Z" fill="currentColor"/></svg>
                </div>
                <div class="chat-ai-body">
                    <div class="chat-thinking"><span></span><span></span><span></span></div>
                </div>
            `;
            convZone.appendChild(aiBubble);

            if (window.gsap) {
                window.gsap.fromTo(aiBubble, { opacity: 0, y: 15 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out', delay: 0.1 });
            }

            // Archive and freeze the previous outline state into a gorgeous static summary
            const outlineContainer = document.getElementById('outline-container');
            if (outlineContainer) {
                const slidesContainer = document.getElementById('outline-slides-container');
                if (slidesContainer && !outlineContainer.classList.contains('hidden')) {
                    // Create a static read-only snapshot
                    const staticSummary = document.createElement('div');
                    staticSummary.className = 'historical-outline-summary';

                    const slideItems = slidesContainer.querySelectorAll('.seamless-slide-item');
                    slideItems.forEach(item => {
                        const num = item.querySelector('.seamless-slide-number')?.textContent || '';
                        const title = item.querySelector('.outline-slide-title')?.value || '';
                        const points = Array.from(item.querySelectorAll('.outline-point-input')).map(input => input.value);

                        const slideEl = document.createElement('div');
                        slideEl.className = 'historical-slide-item';
                        slideEl.innerHTML = `
                            <div class="historical-slide-number">${escapeHtml(num)}</div>
                            <div class="historical-slide-title">${escapeHtml(title)}</div>
                            <div class="historical-points-list">
                                ${points.map(pt => `
                                    <div class="historical-point-item">
                                        <span class="historical-point-bullet">-</span>
                                        <span class="historical-point-text">${escapeHtml(pt)}</span>
                                    </div>
                                `).join('')}
                            </div>
                        `;
                        staticSummary.appendChild(slideEl);
                    });

                    // Replace the active editor container in the old AI bubble with the static read-only snapshot
                    const oldParent = outlineContainer.parentNode;
                    if (oldParent) {
                        oldParent.insertBefore(staticSummary, outlineContainer);

                        if (window.gsap) {
                            window.gsap.fromTo(staticSummary, { opacity: 0 }, { opacity: 0.5, duration: 0.3 });
                        }

                        // No need to remove chips or footers here since outlineContainer is moved entirely.
                        // The old bubble will just retain the staticSummary.
                    }
                }

                // Now safely detach the active outline editor and move it to the new AI loading bubble
                outlineContainer.classList.add('hidden');
                aiBubble.querySelector('.chat-ai-body').appendChild(outlineContainer);
            }
        } else {
            // First loading state: populate the static placeholders
            const userTextEl = document.getElementById('chat-user-text');
            if (userTextEl) {
                userTextEl.textContent = promptText;
                if (window.gsap) {
                    const firstUserBubble = document.getElementById('chat-user-bubble');
                    if (firstUserBubble) {
                        window.gsap.fromTo(firstUserBubble, { opacity: 0, y: 15 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' });
                    }
                }
            }
            const thinking = document.getElementById('chat-thinking');
            if (thinking) {
                thinking.classList.remove('hidden');
                if (window.gsap) {
                    const firstAiBubble = document.getElementById('chat-ai-response');
                    if (firstAiBubble) {
                        window.gsap.fromTo(firstAiBubble, { opacity: 0, y: 15 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out', delay: 0.1 });
                    }
                }
            }
        }

        // Auto-scroll to bottom of conversation (force since new content is added)
        scrollToBottom(true);
    }

    // 6. Disable generate/add-slide while loading
    const btnGen = document.getElementById('btn-outline-generate');
    const btnAdd = document.getElementById('btn-outline-add-slide');
    if (btnGen) btnGen.disabled = true;
    if (btnAdd) btnAdd.disabled = true;
}

function parsePartialSkeleton(text) {
    const slides = [];
    // Split using lookahead to preserve the opening bracket of each slide object
    const slideSegments = text.split(/(?=\{\s*"(?:index|role|title)")/);
    
    for (let i = 1; i < slideSegments.length; i++) {
        const seg = slideSegments[i];
        
        let title = '';
        const titleMatch = seg.match(/"title"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
        const typingTitleMatch = seg.match(/"title"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)$/);
        if (titleMatch) {
            title = titleMatch[1];
        } else if (typingTitleMatch) {
            title = typingTitleMatch[1];
        }
        
        const keyPoints = [];
        const pointsSegmentMatch = seg.match(/"key_points"\s*:\s*\[([\s\S]*?)(?:\]|$)/);
        if (pointsSegmentMatch) {
            const pointsText = pointsSegmentMatch[1];
            const pointMatches = pointsText.match(/"([^"\\]*(?:\\.[^"\\]*)*)"/g) || [];
            pointMatches.forEach(m => {
                keyPoints.push(m.slice(1, -1));
            });
            const typingPointMatch = pointsText.match(/,\s*"([^"\\]*(?:\\.[^"\\]*)*)$|^\s*"([^"\\]*(?:\\.[^"\\]*)*)$/);
            if (typingPointMatch) {
                const typingStr = typingPointMatch[1] || typingPointMatch[2];
                keyPoints.push(typingStr);
            }
        }
        
        slides.push({ title, key_points: keyPoints });
    }
    
    return { slides };
}
window.parsePartialSkeleton = parsePartialSkeleton;

window.prepareOutlineStreaming = function(mode) {
    window.outlineEditorState.isLoading = true;
    window.outlineEditorState.skeleton = null;
    window.outlineEditorState.mode = mode;
    window.outlineEditorState.maxSlides = mode === 'pro' ? 8 : 15;
    
    const container = document.getElementById('outline-slides-container');
    if (container) container.innerHTML = '';
    
    const btnGenerate = document.getElementById('btn-generate');
    const btnLang = document.getElementById('btn-lang-dropdown');
    if (btnGenerate) {
        btnGenerate.classList.add('is-generating');
        btnGenerate.disabled = false;
    }
    if (btnLang) btnLang.disabled = true;
    
    const pills = document.getElementById('suggestion-pills-row');
    if (pills) { pills.style.transition = 'opacity 0.3s'; pills.style.opacity = '0'; pills.style.pointerEvents = 'none'; }
    const microcopy = document.querySelector('.app-microcopy');
    if (microcopy) { microcopy.style.transition = 'opacity 0.3s'; microcopy.style.opacity = '0'; }
    const counter = document.querySelector('.chat-counter-row');
    if (counter) { counter.style.transition = 'opacity 0.3s'; counter.style.opacity = '0'; }

    const aiMessages = document.querySelectorAll('.chat-msg-ai');
    const latestAiMessage = aiMessages[aiMessages.length - 1];
    
    if (latestAiMessage) {
        const latestAiBody = latestAiMessage.querySelector('.chat-ai-body');
        const outlineContainer = document.getElementById('outline-container');
        if (latestAiBody && outlineContainer && !latestAiBody.contains(outlineContainer)) {
            latestAiBody.appendChild(outlineContainer);
        }
    }

    const outlineContainer = document.getElementById('outline-container');
    if (outlineContainer) outlineContainer.classList.remove('hidden');
    
    const chipsContainer = document.getElementById('outline-suggested-chips');
    if (chipsContainer) chipsContainer.innerHTML = '';
};

window.renderStreamingOutline = function(partialSkeleton) {
    const container = document.getElementById('outline-slides-container');
    if (!container) return;

    const slides = partialSkeleton.slides || [];
    const existingItems = container.querySelectorAll('.seamless-slide-item');
    
    slides.forEach((slide, index) => {
        let item = existingItems[index];
        if (!item) {
            item = document.createElement('div');
            item.className = 'seamless-slide-item';
            item.dataset.index = index;
            item.innerHTML = `
                <div class="seamless-slide-number">${index + 1}.</div>
                <textarea class="seamless-title-input outline-slide-title" placeholder="Slide Title" data-index="${index}" rows="1" aria-label="Slide Title" disabled></textarea>
                <div class="seamless-points-list" id="outline-points-${index}"></div>
            `;
            container.appendChild(item);
            
            if (window.gsap) {
                window.gsap.fromTo(item, { opacity: 0, x: -12 }, { opacity: 1, x: 0, duration: 0.4, ease: 'power2.out' });
            }
        }
        
        const titleTextarea = item.querySelector('.outline-slide-title');
        if (titleTextarea && titleTextarea.value !== (slide.title || '')) {
            titleTextarea.value = slide.title || '';
            titleTextarea.style.height = 'auto';
            titleTextarea.style.height = titleTextarea.scrollHeight + 'px';
        }
        
        const pointsList = item.querySelector('.seamless-points-list');
        if (pointsList) {
            const existingPoints = pointsList.querySelectorAll('.seamless-point-item');
            const keyPoints = slide.key_points || [];
            
            keyPoints.forEach((point, pIndex) => {
                let pItem = existingPoints[pIndex];
                if (!pItem) {
                    pItem = document.createElement('div');
                    pItem.className = 'seamless-point-item';
                    pItem.innerHTML = `
                        <span class="seamless-point-bullet">-</span>
                        <textarea class="seamless-point-input outline-point-input" data-sindex="${index}" data-pindex="${pIndex}" rows="1" aria-label="Bullet point" disabled></textarea>
                    `;
                    pointsList.appendChild(pItem);
                    
                    if (window.gsap) {
                        window.gsap.fromTo(pItem, { opacity: 0, x: -8 }, { opacity: 1, x: 0, duration: 0.3, ease: 'power2.out' });
                    }
                }
                
                const pTextarea = pItem.querySelector('.outline-point-input');
                if (pTextarea && pTextarea.value !== point) {
                    pTextarea.value = point;
                    pTextarea.style.height = 'auto';
                    pTextarea.style.height = pTextarea.scrollHeight + 'px';
                }
            });
            
            for (let i = keyPoints.length; i < existingPoints.length; i++) {
                existingPoints[i].remove();
            }
        }
    });
    
    for (let i = slides.length; i < existingItems.length; i++) {
        existingItems[i].remove();
    }
    
    scrollToBottom();
};

window.finalizeStreamingOutline = function(finalSkeleton) {
    window.outlineEditorState.skeleton = finalSkeleton;
    
    // Populate hidden config tags
    const titleInput = document.getElementById('outline-title-input');
    if (titleInput) { titleInput.value = finalSkeleton.topic || ''; titleInput.disabled = false; }
    const toneVal = finalSkeleton.tone || 'academic';
    const toneEl = document.getElementById('outline-tone-select');
    if (toneEl) { toneEl.value = toneVal; if (!toneEl.value) toneEl.value = 'academic'; }
    const audEl = document.getElementById('outline-audience-select');
    if (audEl) audEl.value = finalSkeleton.audience || 'general';
    const densEl = document.getElementById('outline-density-select');
    if (densEl) densEl.value = finalSkeleton.density || finalSkeleton.text_density || 'medium';
    const subEl = document.getElementById('outline-subtitle-input');
    if (subEl) subEl.value = finalSkeleton.subtitle_context || '';

    // Render standard slides to replace disabled textareas and bind all events (like draggable, inputs etc.)
    renderOutlineSlides();
    
    // Render Suggested Action Chips Row
    window.renderOutlineSuggestedChips(finalSkeleton);

    // Mark loading as false and enable controls
    window.outlineEditorState.isLoading = false;
    
    // Re-enable global buttons and remove is-generating class
    const btnGenerate = document.getElementById('btn-generate');
    if (btnGenerate) {
        btnGenerate.classList.remove('is-generating');
        btnGenerate.disabled = false;
    }
    const btnLang = document.getElementById('btn-lang-dropdown');
    if (btnLang) btnLang.disabled = false;
    
    const btnGen = document.getElementById('btn-outline-generate');
    const btnAdd = document.getElementById('btn-outline-add-slide');
    if (btnGen) btnGen.disabled = false;
    if (btnAdd) btnAdd.disabled = false;
    
    if (typeof window.validateGenerateButton === 'function') {
        window.validateGenerateButton();
    }
};

window.renderOutlineSuggestedChips = function(skeletonData) {
    const chipsContainer = document.getElementById('outline-suggested-chips');
    if (!chipsContainer) return;
    chipsContainer.innerHTML = '';

    let suggestedChips = [];
    const isEnglish = (skeletonData.language || 'es').toLowerCase().startsWith('en');

    const t = (key, fallback) => {
        if (typeof window !== 'undefined' && window.__t) {
            return window.__t(key);
        }
        return fallback;
    };

    if (skeletonData.suggested_chips && Array.isArray(skeletonData.suggested_chips) && skeletonData.suggested_chips.length > 0) {
        suggestedChips = skeletonData.suggested_chips.map(chipText => ({
            text: chipText,
            prompt: chipText
        }));

        suggestedChips.push({
            text: t('chip_fallback_generate_text', isEnglish ? 'Looks good! Create presentation' : 'Todo listo! Crear presentación'),
            primary: true,
            action: 'generate'
        });
    } else {
        suggestedChips = [
            {
                text: t('chip_fallback_tone_prof_text', 'Cambiar a tono profesional'),
                prompt: t('chip_fallback_tone_prof_prompt', 'Cambia el tono de la presentación a uno más corporativo, formal y profesional')
            },
            {
                text: t('chip_fallback_tone_play_text', 'Hacerlo más divertido'),
                prompt: t('chip_fallback_tone_play_prompt', 'Modifica el tono para que sea más divertido, dinámico y creativo')
            },
            {
                text: t('chip_fallback_add_slide_text', 'Añadir diapositiva relevante'),
                prompt: t('chip_fallback_add_slide_prompt', 'Sugiéreme y añade una nueva diapositiva relevante y lógica al esquema actual')
            },
            {
                text: t('chip_fallback_explain_text', 'Explicar con más detalle'),
                prompt: t('chip_fallback_explain_prompt', 'Haz que los puntos clave de las diapositivas sean más detallados, informativos y descriptivos')
            },
            {
                text: t('chip_fallback_generate_text', 'Todo listo! Crear presentación'),
                primary: true,
                action: 'generate'
            }
        ];
    }

    suggestedChips.forEach((chip, cIdx) => {
        const btn = document.createElement('button');
        btn.className = `suggested-chip ${chip.primary ? 'chip-primary' : ''}`;
        btn.type = 'button';
        btn.innerHTML = chip.text;

        btn.addEventListener('click', () => {
            const inputEl = document.getElementById('w-tema');
            const btnGenerateMain = document.getElementById('btn-generate');
            if (inputEl && btnGenerateMain) {
                inputEl.value = chip.prompt || chip.text;
                inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                btnGenerateMain.disabled = false;
                btnGenerateMain.click();
            }
        });
        chipsContainer.appendChild(btn);

        if (window.gsap) {
            window.gsap.fromTo(btn, { opacity: 0, scale: 0.8, y: 10 }, { opacity: 1, scale: 1, y: 0, duration: 0.35, ease: 'back.out(1.2)', delay: cIdx * 0.05 });
        }
    });
};

function initOutlineEditor(skeletonData, mode) {
    window.prepareOutlineStreaming(mode);
    window.finalizeStreamingOutline(skeletonData);
}

function renderOutlineSlides() {
    const container = document.getElementById('outline-slides-container');
    container.innerHTML = '';

    const slides = window.outlineEditorState.skeleton.slides || [];

    slides.forEach((slide, index) => {
        const item = document.createElement('div');
        item.className = 'seamless-slide-item';
        item.dataset.index = index;

        item.innerHTML = `
            <div class="seamless-slide-number">${index + 1}.</div>
            <textarea class="seamless-title-input outline-slide-title" placeholder="Slide Title" data-index="${index}" rows="1" aria-label="Slide Title">${escapeHtml(slide.title || '')}</textarea>
            
            <div class="seamless-points-list" id="outline-points-${index}">
                ${(slide.key_points || []).map((point, pIndex) => `
                    <div class="seamless-point-item">
                        <span class="seamless-point-bullet">-</span>
                        <textarea class="seamless-point-input outline-point-input" data-sindex="${index}" data-pindex="${pIndex}" rows="1" aria-label="Bullet point">${escapeHtml(point)}</textarea>
                    </div>
                `).join('')}
            </div>
        `;

        container.appendChild(item);
    });

    bindOutlineEvents();
}

function bindOutlineEvents() {

    // Bug #21: Use debounce for textarea inputs to avoid reflow on every keystroke
    function debounce(fn, ms) {
        let timer;
        return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
    }

    // Helper for auto-resizing textareas
    const autoResizeTextarea = (el) => {
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = (el.scrollHeight) + 'px';
    };

    // Add event listeners for inputs — use dataset.index to always read from live state
    document.querySelectorAll('.outline-slide-title').forEach(input => {
        autoResizeTextarea(input);
        input.addEventListener('input', debounce((e) => {
            autoResizeTextarea(e.target);
            const idx = parseInt(e.target.dataset.index, 10);
            const slides = window.outlineEditorState.skeleton.slides;
            if (slides[idx] !== undefined) slides[idx].title = e.target.value;
        }, 80));
    });
    document.querySelectorAll('.outline-slide-desc').forEach(input => {
        autoResizeTextarea(input);
        input.addEventListener('input', debounce((e) => {
            autoResizeTextarea(e.target);
            const idx = parseInt(e.target.dataset.index, 10);
            const slides = window.outlineEditorState.skeleton.slides;
            if (slides[idx] !== undefined) slides[idx].subtitle = e.target.value;
        }, 80));
    });
    document.querySelectorAll('.outline-slide-type-select').forEach(select => {
        select.addEventListener('change', (e) => {
            const idx = parseInt(e.target.dataset.index, 10);
            const slides = window.outlineEditorState.skeleton.slides;
            if (slides[idx] !== undefined) slides[idx].role = e.target.value;
        });
    });

    // Initialize custom Slide Type dropdowns
    document.querySelectorAll('.slide-type-dropdown').forEach(container => {
        const trigger = container.querySelector('.custom-select-trigger');
        const menu = container.querySelector('.custom-select-menu');
        const hiddenSelect = container.querySelector('.outline-slide-type-select');
        const labelSpan = trigger.querySelector('.trigger-label');

        if (trigger && menu && hiddenSelect) {
            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                document.querySelectorAll('.slide-type-dropdown .custom-select-menu').forEach(otherMenu => {
                    if (otherMenu !== menu) {
                        otherMenu.classList.add('hidden');
                        otherMenu.parentElement.querySelector('.custom-select-trigger')?.setAttribute('aria-expanded', 'false');
                    }
                });
                const isHidden = menu.classList.toggle('hidden');
                trigger.setAttribute('aria-expanded', !isHidden);
            });

            menu.querySelectorAll('.dropdown-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const val = item.getAttribute('data-value');
                    hiddenSelect.value = val;
                    labelSpan.textContent = item.textContent;

                    menu.querySelectorAll('.dropdown-item').forEach(btn => btn.classList.remove('active'));
                    item.classList.add('active');

                    hiddenSelect.dispatchEvent(new Event('change'));

                    menu.classList.add('hidden');
                    trigger.setAttribute('aria-expanded', 'false');
                });
            });
        }
    });
    document.querySelectorAll('.outline-point-input').forEach(input => {
        autoResizeTextarea(input);

        // Handle auto-add new point on Enter
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                const sIdx = parseInt(e.target.dataset.sindex, 10);
                const pIdx = parseInt(e.target.dataset.pindex, 10);
                const slides = window.outlineEditorState.skeleton.slides;
                if (slides[sIdx] && slides[sIdx].key_points) {
                    slides[sIdx].key_points.splice(pIdx + 1, 0, "");
                    renderOutlineSlides();

                    // Focus the new input
                    setTimeout(() => {
                        const newInputs = document.querySelectorAll(`.outline-point-input[data-sindex="${sIdx}"]`);
                        if (newInputs[pIdx + 1]) {
                            newInputs[pIdx + 1].focus();
                        }
                    }, 10);
                }
            } else if (e.key === 'Backspace' && e.target.value === '') {
                e.preventDefault();
                const sIdx = parseInt(e.target.dataset.sindex, 10);
                const pIdx = parseInt(e.target.dataset.pindex, 10);
                const slides = window.outlineEditorState.skeleton.slides;
                if (slides[sIdx] && slides[sIdx].key_points && slides[sIdx].key_points.length > 1) {
                    slides[sIdx].key_points.splice(pIdx, 1);
                    renderOutlineSlides();

                    // Focus previous
                    setTimeout(() => {
                        const inputs = document.querySelectorAll(`.outline-point-input[data-sindex="${sIdx}"]`);
                        if (inputs[Math.max(0, pIdx - 1)]) {
                            const prevInput = inputs[Math.max(0, pIdx - 1)];
                            prevInput.focus();
                            prevInput.setSelectionRange(prevInput.value.length, prevInput.value.length);
                        }
                    }, 10);
                }
            }
        });

        input.addEventListener('input', debounce((e) => {
            autoResizeTextarea(e.target);
            const sIdx = parseInt(e.target.dataset.sindex, 10);
            const pIdx = parseInt(e.target.dataset.pindex, 10);
            const slides = window.outlineEditorState.skeleton.slides;
            if (slides[sIdx] && slides[sIdx].key_points) {
                slides[sIdx].key_points[pIdx] = e.target.value;
            }
        }, 80));
    });
    document.querySelectorAll('.outline-point-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const btnEl = e.target.closest('.outline-point-delete');
            const sIdx = parseInt(btnEl.dataset.sindex, 10);
            const pIdx = parseInt(btnEl.dataset.pindex, 10);
            const slides = window.outlineEditorState.skeleton.slides;
            if (slides[sIdx]) slides[sIdx].key_points.splice(pIdx, 1);
            renderOutlineSlides();
        });
    });
    document.querySelectorAll('.outline-slide-color-picker').forEach(picker => {
        picker.addEventListener('input', (e) => {
            const idx = parseInt(e.target.dataset.index, 10);
            const slides = window.outlineEditorState.skeleton.slides;
            if (slides[idx] !== undefined) slides[idx].bg_color = e.target.value;
            const card = e.target.closest('.outline-slide-card');
            const indicator = card && card.querySelector('.outline-slide-bg-indicator');
            if (indicator) indicator.style.backgroundColor = e.target.value;
        });
    });

    updateOutlineSlideCount();
}

window.stopOutlineGeneration = function () {
    // 1. Render all slides statically right away so the user doesn't lose what was streamed so far
    if (window.outlineEditorState && window.outlineEditorState.skeleton) {
        renderOutlineSlides();
        window.renderOutlineSuggestedChips(window.outlineEditorState.skeleton);
    }

    // 2. Mark loading as false and enable controls
    window.outlineEditorState.isLoading = false;

    // 3. Re-enable global buttons and remove is-generating class
    const btnGenerate = document.getElementById('btn-generate');
    if (btnGenerate) {
        btnGenerate.classList.remove('is-generating');
        btnGenerate.disabled = false;
    }
    const btnLang = document.getElementById('btn-lang-dropdown');
    if (btnLang) btnLang.disabled = false;

    const btnGen = document.getElementById('btn-outline-generate');
    const btnAdd = document.getElementById('btn-outline-add-slide');
    if (btnGen) btnGen.disabled = false;
    if (btnAdd) btnAdd.disabled = false;

    if (typeof window.validateGenerateButton === 'function') {
        window.validateGenerateButton();
    }
};

function updateOutlineSlideCount() {
    const slides = window.outlineEditorState.skeleton.slides || [];
    const countEl = document.getElementById('outline-slide-count');
    if (countEl) countEl.textContent = `${slides.length} slides`;

    const addSlideBtn = document.getElementById('btn-outline-add-slide');
    if (addSlideBtn) {
        if (slides.length >= window.outlineEditorState.maxSlides) {
            addSlideBtn.disabled = true;
            addSlideBtn.title = `Maximum limit of ${window.outlineEditorState.maxSlides} slides reached.`;
        } else {
            addSlideBtn.disabled = false;
            addSlideBtn.title = '';
        }
    }
}

function addBlankSlide() {
    const slides = window.outlineEditorState.skeleton.slides;
    if (slides.length >= window.outlineEditorState.maxSlides) return;

    slides.push({
        role: "concept",
        title: "",
        subtitle: "",
        key_points: []
    });
    renderOutlineSlides();

    // Bug #7/#20: scroll to bottom AFTER render, then animate the new card in
    const main = document.querySelector('.outline-main');
    requestAnimationFrame(() => {
        if (main) main.scrollTop = main.scrollHeight;
        // Animate the last card as newly added
        const cards = document.querySelectorAll('.outline-slide-card');
        const newCard = cards[cards.length - 1];
        if (newCard) {
            newCard.classList.add('is-new');
            requestAnimationFrame(() => newCard.classList.add('is-new-visible'));
            setTimeout(() => { newCard.classList.remove('is-new', 'is-new-visible'); }, 500);
        }
    });
}

async function addSlideWithAI() {
    const slides = window.outlineEditorState.skeleton.slides;
    if (slides.length >= window.outlineEditorState.maxSlides) return;

    const topic = document.getElementById('outline-title-input').value;

    const btn = document.getElementById('btn-add-slide-ai');
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Generating...';
    btn.disabled = true;

    // Inject a loading skeleton card at the bottom
    const container = document.getElementById('outline-slides-container');
    const loadingCard = document.createElement('div');
    loadingCard.className = 'outline-slide-card is-loading is-ai-loading is-new';
    loadingCard.innerHTML = `
        <div class="outline-slide-bg-indicator" style="background-color: #121212"></div>
        <div class="outline-slide-number skeleton-loading-pulse" style="color:transparent">-</div>
        <div class="outline-slide-content">
            <div class="outline-slide-header">
                <div class="outline-slide-title skeleton-loading-pulse"></div>
                <div class="outline-slide-type-select skeleton-loading-pulse" style="width: 80px; height: 1.5rem; border-radius: 6px;"></div>
            </div>
            <div class="outline-slide-desc skeleton-loading-pulse"></div>
            <div class="outline-points-list">
                <div class="outline-point-item">
                    <span class="outline-point-bullet skeleton-loading-pulse"></span>
                    <div class="outline-point-input skeleton-loading-pulse"></div>
                </div>
                <div class="outline-point-item">
                    <span class="outline-point-bullet skeleton-loading-pulse"></span>
                    <div class="outline-point-input skeleton-loading-pulse" style="width: 60%"></div>
                </div>
            </div>
        </div>
    `;
    container.appendChild(loadingCard);

    // Animate the skeleton in and scroll to bottom immediately
    requestAnimationFrame(() => {
        const main = document.querySelector('.outline-main');
        if (main) main.scrollTop = main.scrollHeight;
        loadingCard.classList.add('is-new-visible');
    });

    try {
        const response = await fetch('/generate-outline-item', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'slide',
                topic: topic,
                existingSlides: slides
            })
        });

        if (!response.ok) throw new Error('Generation failed');

        const data = await response.json();
        if (data.item) {
            slides.push(data.item);
            renderOutlineSlides();
            // Same enter animation as addBlankSlide
            const main = document.querySelector('.outline-main');
            requestAnimationFrame(() => {
                if (main) main.scrollTop = main.scrollHeight;
                const cards = document.querySelectorAll('.outline-slide-card');
                const newCard = cards[cards.length - 1];
                if (newCard) {
                    newCard.classList.add('is-new');
                    requestAnimationFrame(() => newCard.classList.add('is-new-visible'));
                    setTimeout(() => { newCard.classList.remove('is-new', 'is-new-visible'); }, 500);
                }
            });
        }
    } catch (e) {
        console.error(e);
        alert('Failed to generate slide. Please try again.');
    } finally {
        // Remove the loading skeleton card (renderOutlineSlides would overwrite it anyway, but this is safer for failures)
        if (loadingCard && loadingCard.parentNode) {
            loadingCard.parentNode.removeChild(loadingCard);
        }
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

function addBlankPoint(slideIndex) {
    const slides = window.outlineEditorState.skeleton.slides;
    if (!slides[slideIndex].key_points) slides[slideIndex].key_points = [];
    slides[slideIndex].key_points.push("");

    // Bug #10: Instead of full re-render, only re-render the affected slide card's point list
    // so the user doesn't lose focus on other fields.
    const pointList = document.getElementById(`outline-points-${slideIndex}`);
    if (pointList) {
        const pIdx = slides[slideIndex].key_points.length - 1;
        const newItem = document.createElement('div');
        newItem.className = 'outline-point-item';
        newItem.innerHTML = `
            <span class="outline-point-bullet">●</span>
            <textarea class="outline-point-input" data-sindex="${slideIndex}" data-pindex="${pIdx}" rows="1" aria-label="Bullet point" style="height: auto; resize: none; overflow-y: hidden;"></textarea>
            <button type="button" class="outline-point-delete" data-sindex="${slideIndex}" data-pindex="${pIdx}">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
        `;
        pointList.appendChild(newItem);

        // Wire up the new textarea
        const textarea = newItem.querySelector('.outline-point-input');
        const autoResize = (el) => { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; };
        textarea.addEventListener('input', (e) => {
            autoResize(e.target);
            const sIdx = parseInt(e.target.dataset.sindex, 10);
            const pIx = parseInt(e.target.dataset.pindex, 10);
            const sl = window.outlineEditorState.skeleton.slides;
            if (sl[sIdx] && sl[sIdx].key_points) sl[sIdx].key_points[pIx] = e.target.value;
        });

        // Wire up the delete button
        const deleteBtn = newItem.querySelector('.outline-point-delete');
        deleteBtn.addEventListener('click', () => {
            const sIdx = parseInt(deleteBtn.dataset.sindex, 10);
            const pIx = parseInt(deleteBtn.dataset.pindex, 10);
            const sl = window.outlineEditorState.skeleton.slides;
            if (sl[sIdx]) sl[sIdx].key_points.splice(pIx, 1);
            renderOutlineSlides();
        });

        // Bug #10: Focus the new textarea so user can immediately type
        textarea.focus();
        // Animate in
        newItem.classList.add('is-new');
        requestAnimationFrame(() => newItem.classList.add('is-new-visible'));
        setTimeout(() => newItem.classList.remove('is-new', 'is-new-visible'), 400);
    } else {
        // Fallback: full re-render if DOM element not found
        renderOutlineSlides();
    }
}

function deleteSlide(index) {
    if (confirm('Are you sure you want to delete this slide?')) {
        window.outlineEditorState.skeleton.slides.splice(index, 1);
        renderOutlineSlides();
    }
}

function moveSlideUp(index) {
    if (index === 0) return;
    const slides = window.outlineEditorState.skeleton.slides;
    const temp = slides[index - 1];
    slides[index - 1] = slides[index];
    slides[index] = temp;
    // Bug #20: preserve scroll position after re-render
    const main = document.querySelector('.outline-main');
    const scrollTop = main ? main.scrollTop : 0;
    renderOutlineSlides();
    requestAnimationFrame(() => { if (main) main.scrollTop = scrollTop; });
}

function moveSlideDown(index) {
    const slides = window.outlineEditorState.skeleton.slides;
    if (index === slides.length - 1) return;
    const temp = slides[index + 1];
    slides[index + 1] = slides[index];
    slides[index] = temp;
    const main = document.querySelector('.outline-main');
    const scrollTop = main ? main.scrollTop : 0;
    renderOutlineSlides();
    requestAnimationFrame(() => { if (main) main.scrollTop = scrollTop; });
}

function resumeOutlineEditor() {
    if (!window.outlineEditorState.skeleton) {
        window.outlineEditorState.skeleton = { slides: [] };
    }

    // Ensure all editing UI elements are visible when resuming a real draft
    document.querySelector('.outline-sidebar')?.style.removeProperty('display');
    document.querySelector('.outline-main-header')?.style.removeProperty('display');
    document.getElementById('legacy-outline-title-input')?.style.removeProperty('display');
    document.querySelector('.outline-floating-footer')?.style.removeProperty('display');
    const emptyState = document.getElementById('outline-empty-state');
    if (emptyState) emptyState.classList.add('hidden');

    if (window.__applyTranslations) window.__applyTranslations();

    // Sync custom dropdown UI values when resuming
    if (typeof syncCustomDropdowns === 'function') syncCustomDropdowns();

    document.getElementById('outline-container').classList.remove('hidden');

    const backdrop = document.getElementById('outline-backdrop');
    if (backdrop) backdrop.classList.add('active');

    const edgeTab = document.getElementById('outline-edge-tab');
    if (edgeTab) {
        edgeTab.classList.add('is-open');
        const tabText = edgeTab.querySelector('span');
        if (tabText) tabText.textContent = window.__t ? window.__t('close_draft', 'Close draft') : 'Close draft';
    }

    const heroTextSpan = document.querySelector('.hero-title-text');
    if (heroTextSpan) {
        // Kill typewriter before overwriting hero text
        if (window._heroTypewriterTimer) {
            clearTimeout(window._heroTypewriterTimer);
            window._heroTypewriterTimer = null;
        }
        if (window._heroResetTimer) {
            clearTimeout(window._heroResetTimer);
            window._heroResetTimer = null;
        }
        if (window._btnMsgTimer) {
            clearTimeout(window._btnMsgTimer);
            window._btnMsgTimer = null;
        }
        const heroTitle = document.querySelector('.hero-title');
        if (window.gsap && heroTitle) {
            window.gsap.killTweensOf(heroTitle);
            window.gsap.set(heroTitle, { x: 0, opacity: 1 });
        }
        if (!heroTextSpan.getAttribute('data-original-text')) {
            heroTextSpan.setAttribute('data-original-text', heroTextSpan.textContent);
        }
        if (window.outlineEditorState.isLoading) {
            heroTextSpan.textContent = window.__t ? window.__t('generating_outline', 'Generating structure...') : 'Generating structure...';
        } else {
            heroTextSpan.textContent = window.__t ? window.__t('waiting_for_user', 'Waiting for your review...') : 'Waiting for your review...';
        }
        heroTextSpan.parentElement.classList.add('waiting-state');
    }
}

// Global functions
window.showOutlineEditorLoading = showOutlineEditorLoading;
window.initOutlineEditor = initOutlineEditor;
window.resumeOutlineEditor = resumeOutlineEditor;
window.addBlankPoint = addBlankPoint;
window.deleteSlide = deleteSlide;
window.moveSlideUp = moveSlideUp;
window.moveSlideDown = moveSlideDown;

function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return '';
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function syncCustomDropdowns() {
    ['tone', 'audience', 'density'].forEach(type => {
        const select = document.getElementById(`outline-${type}-select`);
        const trigger = document.getElementById(`btn-outline-${type}-dropdown`);
        if (select && trigger) {
            const val = select.value;
            const activeItem = document.querySelector(`#outline-${type}-dropdown-menu .dropdown-item[data-value="${val}"]`);
            const labelSpan = trigger.querySelector('.trigger-label');
            if (activeItem && labelSpan) {
                // Keep the exact data-i18n translation key to support dynamic translations
                if (activeItem.getAttribute('data-i18n')) {
                    labelSpan.setAttribute('data-i18n', activeItem.getAttribute('data-i18n'));
                } else {
                    labelSpan.removeAttribute('data-i18n');
                }
                labelSpan.textContent = activeItem.textContent;

                // Toggle active styling
                document.querySelectorAll(`#outline-${type}-dropdown-menu .dropdown-item`).forEach(btn => {
                    btn.classList.toggle('active', btn === activeItem);
                });
            }
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    // Custom Sidebar Select Dropdowns
    ['tone', 'audience', 'density'].forEach(type => {
        const container = document.getElementById(`outline-${type}-dropdown-container`);
        if (!container) return;

        const trigger = document.getElementById(`btn-outline-${type}-dropdown`);
        const menu = document.getElementById(`outline-${type}-dropdown-menu`);
        const select = document.getElementById(`outline-${type}-select`);

        if (trigger && menu && select) {
            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                // Close other custom menus
                document.querySelectorAll('.outline-custom-dropdown .dropdown-menu').forEach(otherMenu => {
                    if (otherMenu !== menu) {
                        otherMenu.classList.add('hidden');
                        otherMenu.parentElement.querySelector('.custom-select-trigger')?.setAttribute('aria-expanded', 'false');
                    }
                });

                const isHidden = menu.classList.toggle('hidden');
                trigger.setAttribute('aria-expanded', !isHidden);
            });

            menu.querySelectorAll('.dropdown-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const val = item.getAttribute('data-value');
                    select.value = val;

                    // Dispatch change event to notify skeleton builder
                    select.dispatchEvent(new Event('change'));

                    syncCustomDropdowns();
                    menu.classList.add('hidden');
                    trigger.setAttribute('aria-expanded', 'false');
                });
            });
        }
    });

    // Close custom dropdowns on document click
    document.addEventListener('click', () => {
        document.querySelectorAll('.outline-custom-dropdown .dropdown-menu').forEach(menu => {
            menu.classList.add('hidden');
            menu.parentElement.querySelector('.custom-select-trigger')?.setAttribute('aria-expanded', 'false');
        });
    });

    // Add Slide Button
    const addSlideBtn = document.getElementById('btn-outline-add-slide');
    if (addSlideBtn) {
        addSlideBtn.addEventListener('click', (e) => {
            e.preventDefault();
            addBlankSlide();
        });
    }

    // Generate Button
    const btnGenerate = document.getElementById('btn-outline-generate');
    if (btnGenerate) {
        btnGenerate.addEventListener('click', () => {
            if (btnGenerate.disabled) return;

            // Re-sync global settings
            const skel = window.outlineEditorState.skeleton;
            skel.topic = document.getElementById('outline-title-input').value;
            skel.tone = document.getElementById('outline-tone-select').value;
            skel.audience = document.getElementById('outline-audience-select').value;
            skel.density = document.getElementById('outline-density-select').value;

            // Fix #13: Persist the additional context from outline-subtitle-input
            const subtitleInput = document.getElementById('outline-subtitle-input');
            if (subtitleInput) skel.subtitle_context = subtitleInput.value.trim();

            // Fix #15: Validate at least one slide exists
            if (!skel.slides || skel.slides.length === 0) {
                alert(window.__t ? window.__t('outline_empty_slides', 'Please add at least one slide before generating.') : 'Please add at least one slide before generating.');
                return;
            }

            // Clean up empty points
            skel.slides.forEach(slide => {
                if (slide.key_points) {
                    slide.key_points = slide.key_points.filter(p => p && p.trim() !== '');
                }
            });

            btnGenerate.disabled = true;
            // Add loading state to button (morphs into textless filling progress bar)
            btnGenerate.classList.add('is-generating');

            // Call app.js (we DO NOT hide outline-container here. We let the transition hide it when first slide renders!)
            if (window.startFinalGeneration) {
                window.startFinalGeneration(skel);
            }
        });
    }

    // Back to Chat button
    const btnBack = document.getElementById('btn-outline-back');
    if (btnBack) {
        btnBack.addEventListener('click', () => {
            const msg = window.__t ? window.__t('confirm_exit_draft', 'Are you sure you want to go back? Your progress will be lost.') : 'Are you sure you want to go back? Your progress will be lost.';
            if (!confirm(msg)) return;

            // Fix #6: Abort any in-flight skeleton or generation fetch
            if (window._activeGenController) {
                window._activeGenController.abort();
                window._activeGenController = null;
            }

            // Hide container so beforeunload doesn't fire a duplicate warning
            const container = document.getElementById('outline-container');
            if (container) container.classList.add('hidden');

            // Cleanly return to the main menu with a pristine Home URL (no hashes)
            window.location.href = window.location.origin + window.location.pathname;
        });
    }

    // Backdrop click closes the drawer
    const backdrop = document.getElementById('outline-backdrop');
    if (backdrop && btnBack) {
        backdrop.addEventListener('click', () => {
            btnBack.click();
        });
    }

    // Edge tab opens/closes the drawer
    const edgeTab = document.getElementById('outline-edge-tab');
    if (edgeTab) {
        edgeTab.addEventListener('click', () => {
            if (edgeTab.classList.contains('is-open')) {
                const btnBack = document.getElementById('btn-outline-back');
                if (btnBack) btnBack.click();
            } else if (window.outlineEditorState.skeleton) {
                // There is a draft — resume it normally
                resumeOutlineEditor();
            } else {
                // No draft generated yet — open the panel showing ONLY the empty state
                const container = document.getElementById('outline-container');
                if (container) container.classList.remove('hidden');

                // Show empty state, hide all editing UI
                const emptyState = document.getElementById('outline-empty-state');
                if (emptyState) emptyState.classList.remove('hidden');
                document.querySelector('.outline-sidebar')?.style.setProperty('display', 'none');
                document.querySelector('.outline-main-header')?.style.setProperty('display', 'none');
                document.getElementById('legacy-outline-title-input')?.style.setProperty('display', 'none');
                document.querySelector('.outline-floating-footer')?.style.setProperty('display', 'none');

                edgeTab.classList.add('is-open');
                const tabText = edgeTab.querySelector('span');
                if (tabText) tabText.textContent = window.__t ? window.__t('close_draft', 'Close draft') : 'Close draft';

                // Apply translations so the empty state shows the correct language
                if (window.__applyTranslations) window.__applyTranslations();
            }
        });
    }
});
