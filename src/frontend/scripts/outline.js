// Outline Editor Logic

window.outlineEditorState = {
    skeleton: null,
    mode: 'flash',
    maxSlides: 15,
    isLoading: false
};

function showOutlineEditorLoading(slideCount = 8) {
    window.outlineEditorState.isLoading = true;
    document.getElementById('outline-container').classList.remove('hidden');
    
    const backdrop = document.getElementById('outline-backdrop');
    if (backdrop) backdrop.classList.add('active');
    
    const edgeTab = document.getElementById('outline-edge-tab');
    if (edgeTab) {
        edgeTab.classList.add('is-open');
        const tabText = edgeTab.querySelector('span');
        if (tabText) tabText.textContent = window.__t ? window.__t('close_draft', 'Close draft') : 'Close draft';
    }
    // Update Hero Title in chat screen to say "Generating outline..."
    const heroTextSpan = document.querySelector('.hero-title-text');
    if (heroTextSpan) {
        if (!heroTextSpan.getAttribute('data-original-text')) {
            heroTextSpan.setAttribute('data-original-text', heroTextSpan.textContent);
        }
        heroTextSpan.textContent = window.__t('generating_outline', 'Generating structure...');
        heroTextSpan.parentElement.classList.add('waiting-state');
    }

    // Disable generate button and inputs
    document.getElementById('btn-outline-generate').disabled = true;
    document.getElementById('btn-outline-add-slide').disabled = true;
    document.getElementById('outline-title-input').value = window.__t('generating', 'Generating...');
    document.getElementById('outline-title-input').disabled = true;
    document.querySelectorAll('.outline-select').forEach(el => el.disabled = true);

    const container = document.getElementById('outline-slides-container');
    container.innerHTML = '';
    
    // Generate placeholder cards
    for (let i = 0; i < slideCount; i++) {
        const card = document.createElement('div');
        card.className = 'outline-slide-card is-loading';
        card.innerHTML = `
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
            <div class="outline-slide-controls">
                <div class="outline-slide-action-btn skeleton-loading-pulse"></div>
                <div class="outline-slide-action-btn skeleton-loading-pulse"></div>
                <div class="outline-slide-action-btn skeleton-loading-pulse"></div>
            </div>
        `;
        container.appendChild(card);
    }
}

function initOutlineEditor(skeletonData, mode) {
    window.outlineEditorState.isLoading = false;
    window.outlineEditorState.skeleton = skeletonData;
    window.outlineEditorState.mode = mode;
    window.outlineEditorState.maxSlides = mode === 'pro' ? 8 : 15;
    
    // Ensure all editing UI elements are visible when initializing a real draft
    document.querySelector('.outline-sidebar')?.style.removeProperty('display');
    document.querySelector('.outline-main-header')?.style.removeProperty('display');
    document.getElementById('outline-title-input')?.style.removeProperty('display');
    document.querySelector('.outline-floating-footer')?.style.removeProperty('display');
    const emptyState = document.getElementById('outline-empty-state');
    if (emptyState) emptyState.classList.add('hidden');

    if (window.__applyTranslations) window.__applyTranslations();
    
    document.getElementById('outline-container').classList.remove('hidden');
    
    const backdrop = document.getElementById('outline-backdrop');
    if (backdrop) backdrop.classList.add('active');
    
    const edgeTab = document.getElementById('outline-edge-tab');
    if (edgeTab) {
        edgeTab.classList.add('is-open');
        const tabText = edgeTab.querySelector('span');
        if (tabText) tabText.textContent = window.__t ? window.__t('close_draft', 'Close draft') : 'Close draft';
    }
    
    // Update Hero Title in chat screen to say "Waiting for your review..."
    const heroTextSpan = document.querySelector('.hero-title-text');
    if (heroTextSpan) {
        // Kill any in-progress typewriter/GSAP animation from app.js BEFORE changing text,
        // otherwise characters keep appending to the new text ("Got a spicy idea?yzing the topic" bug)
        if (window._heroTypewriterTimer) {
            clearTimeout(window._heroTypewriterTimer);
            window._heroTypewriterTimer = null;
        }
        // Also cancel the 3-second reset timer from stopBtnMessages()
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
            window.gsap.set(heroTitle, { x: 0, opacity: 1 }); // reset to visible
        }

        if (!heroTextSpan.getAttribute('data-original-text')) {
            heroTextSpan.setAttribute('data-original-text', heroTextSpan.textContent);
        }
        heroTextSpan.textContent = window.__t ? window.__t('waiting_for_user', 'Waiting for your review...') : 'Waiting for your review...';
        heroTextSpan.parentElement.classList.add('waiting-state');
    }
    
    // Re-enable generate button and inputs
    document.getElementById('btn-outline-generate').disabled = false;
    document.getElementById('btn-outline-add-slide').disabled = false;
    
    // Populate settings
    const titleInput = document.getElementById('outline-title-input');
    titleInput.value = skeletonData.topic || '';
    titleInput.disabled = false;
    
    // Fix #22: 'formal' is not a valid option in the select — use 'academic' as fallback
    const toneVal = skeletonData.tone || 'academic';
    document.getElementById('outline-tone-select').value = toneVal;
    // If the value wasn't set (no matching option), default to academic
    const toneSelect = document.getElementById('outline-tone-select');
    if (!toneSelect.value) toneSelect.value = 'academic';
    
    document.getElementById('outline-audience-select').value = skeletonData.audience || 'general';
    document.getElementById('outline-density-select').value = skeletonData.density || skeletonData.text_density || 'medium';
    document.querySelectorAll('.outline-select').forEach(el => el.disabled = false);
    
    // Sync the custom styled selects to match the hidden native select values
    if (typeof syncCustomDropdowns === 'function') syncCustomDropdowns();
    
    // Fix #13: Populate subtitle/context input if present
    const subtitleInput = document.getElementById('outline-subtitle-input');
    if (subtitleInput) subtitleInput.value = skeletonData.subtitle_context || '';
    
    renderOutlineSlides();
}

function renderOutlineSlides() {
    const container = document.getElementById('outline-slides-container');
    container.innerHTML = '';
    
    const slides = window.outlineEditorState.skeleton.slides || [];
    
    const emptyState = document.getElementById('outline-empty-state');
    if (slides.length === 0) {
        if (emptyState) emptyState.classList.remove('hidden');
    } else {
        if (emptyState) emptyState.classList.add('hidden');
    }
    
    slides.forEach((slide, index) => {
        const card = document.createElement('div');
        card.className = 'outline-slide-card';
        card.dataset.index = index;
        
        // Use a default color for background indicator if none specified
        const bgColor = slide.bg_color || '#121212';
        
        card.innerHTML = `
            <div class="outline-slide-bg-indicator" style="background-color: ${bgColor}"></div>
            <div class="outline-slide-number">${index + 1}</div>
            <div class="outline-slide-content">
                <div class="outline-slide-header">
                    <textarea class="outline-slide-title" placeholder="Slide Title" data-index="${index}" rows="1" style="height: auto; resize: none; overflow-y: hidden;">${escapeHtml(slide.title || '')}</textarea>
                    <div class="dropdown-container outline-custom-dropdown slide-type-dropdown">
                        <button type="button" class="outline-slide-type-btn custom-select-trigger" aria-expanded="false">
                            <span class="trigger-label">${(slide.role === 'error_list' ? 'Error List' : (slide.role ? slide.role.charAt(0).toUpperCase() + slide.role.slice(1) : 'Concept'))}</span>
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                        </button>
                        <div class="dropdown-menu hidden custom-select-menu">
                            ${['cover', 'problem', 'concept', 'data', 'comparison', 'process', 'example', 'error_list', 'quote', 'timeline', 'internals', 'conclusion'].map(r => 
                                `<button type="button" class="dropdown-item ${slide.role === r || (!slide.role && r === 'concept') ? 'active' : ''}" data-value="${r}">${r === 'error_list' ? 'Error List' : r.charAt(0).toUpperCase() + r.slice(1)}</button>`
                            ).join('')}
                        </div>
                        <select class="outline-slide-type-select hidden-select" data-index="${index}" style="display: none;">
                            ${['cover', 'problem', 'concept', 'data', 'comparison', 'process', 'example', 'error_list', 'quote', 'timeline', 'internals', 'conclusion'].map(r => 
                                `<option value="${r}" ${slide.role === r || (!slide.role && r === 'concept') ? 'selected' : ''}>${r === 'error_list' ? 'Error List' : r.charAt(0).toUpperCase() + r.slice(1)}</option>`
                            ).join('')}
                        </select>
                    </div>
                </div>
                <textarea class="outline-slide-desc" placeholder="Optional subtitle or description" data-index="${index}" rows="2" style="height: auto; resize: none; overflow-y: hidden;">${escapeHtml(slide.subtitle || '')}</textarea>
                
                <div class="outline-points-list" id="outline-points-${index}">
                    ${(slide.key_points || []).map((point, pIndex) => `
                        <div class="outline-point-item">
                            <span class="outline-point-bullet">●</span>
                            <textarea class="outline-point-input" data-sindex="${index}" data-pindex="${pIndex}" rows="1" style="height: auto; resize: none; overflow-y: hidden;">${escapeHtml(point)}</textarea>
                            <button type="button" class="outline-point-delete" data-sindex="${index}" data-pindex="${pIndex}">
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                            </button>
                        </div>
                    `).join('')}
                </div>
                
                <div class="outline-add-point-container">
                    <button type="button" class="btn-outline-add-point" onclick="addBlankPoint(${index})">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                        Add Point
                    </button>
                    <!-- AI Generate point option can be added here if needed -->
                </div>
                
                <div class="outline-slide-bg-color">
                    <label>Slide Color:</label>
                    <input type="color" class="outline-slide-color-picker" data-index="${index}" value="${slide.bg_color || '#121212'}">
                </div>
                
            </div>
            <div class="outline-slide-controls">
                <button type="button" class="outline-slide-action-btn" onclick="moveSlideUp(${index})" ${index === 0 ? 'disabled' : ''}>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"></polyline></svg>
                </button>
                <button type="button" class="outline-slide-action-btn" onclick="moveSlideDown(${index})" ${index === slides.length - 1 ? 'disabled' : ''}>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </button>
                <button type="button" class="outline-slide-action-btn delete" onclick="deleteSlide(${index})">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            </div>
        `;
        
        container.appendChild(card);
    });
    
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

function updateOutlineSlideCount() {
    const slides = window.outlineEditorState.skeleton.slides || [];
    document.getElementById('outline-slide-count').textContent = `${slides.length} slides`;
    
    const addSlideBtn = document.getElementById('btn-outline-add-slide');
    if (slides.length >= window.outlineEditorState.maxSlides) {
        addSlideBtn.disabled = true;
        addSlideBtn.title = `Maximum limit of ${window.outlineEditorState.maxSlides} slides reached.`;
    } else {
        addSlideBtn.disabled = false;
        addSlideBtn.title = '';
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
            <textarea class="outline-point-input" data-sindex="${slideIndex}" data-pindex="${pIdx}" rows="1" style="height: auto; resize: none; overflow-y: hidden;"></textarea>
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
    document.getElementById('outline-title-input')?.style.removeProperty('display');
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

    // Add Slide Dropdown
    const addSlideBtn = document.getElementById('btn-outline-add-slide');
    const addSlideMenu = document.getElementById('outline-add-slide-menu');
    
    if (addSlideBtn && addSlideMenu) {
        addSlideBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            addSlideMenu.classList.toggle('hidden');
        });
        
        document.addEventListener('click', () => {
            addSlideMenu.classList.add('hidden');
        });
        
        document.getElementById('btn-add-slide-blank').addEventListener('click', () => {
            addBlankSlide();
        });
        
        document.getElementById('btn-add-slide-ai').addEventListener('click', () => {
            addSlideWithAI();
        });
    }
    
    // Generate Button
    const btnGenerate = document.getElementById('btn-outline-generate');
    if (btnGenerate) {
        btnGenerate.addEventListener('click', () => {
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
            // Fix #6: Abort any in-flight skeleton or generation fetch
            if (window._activeGenController) {
                window._activeGenController.abort();
                window._activeGenController = null;
            }

            const backdrop = document.getElementById('outline-backdrop');
            if (backdrop) backdrop.classList.remove('active');
            
            const heroTextSpan = document.querySelector('.hero-title-text');
            if (heroTextSpan && heroTextSpan.getAttribute('data-original-text')) {
                // Kill typewriter so it doesn't append chars to restored text
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
                heroTextSpan.textContent = heroTextSpan.getAttribute('data-original-text');
                heroTextSpan.parentElement.classList.remove('waiting-state');
            }
            
            document.getElementById('outline-container').classList.add('hidden');

            // Hide the empty state on close (we do NOT restore editing UI here to prevent flickering)
            const emptyOnClose = document.getElementById('outline-empty-state');
            if (emptyOnClose) emptyOnClose.classList.add('hidden');

            // Fix #17: clean up is-generating state on the generate button
            const btnGen = document.getElementById('btn-outline-generate');
            if (btnGen) btnGen.classList.remove('is-generating');
            
            // Reset the floating edge tab
            const edgeTab = document.getElementById('outline-edge-tab');
            if (edgeTab) {
                edgeTab.classList.remove('is-open');
                const tabText = edgeTab.querySelector('span');
                if (tabText) tabText.textContent = window.__t ? window.__t('open_draft', 'Open draft') : 'Open draft';
            }
            
            // Fix #12: guard optional app.js functions
            if (typeof window.hideLoadingState === 'function') window.hideLoadingState();
            if (typeof window.disableGenerationUI === 'function') window.disableGenerationUI(false);
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
                document.getElementById('outline-title-input')?.style.setProperty('display', 'none');
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
