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
    if (edgeTab) edgeTab.classList.add('hidden');
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
        card.className = 'outline-slide-card is-loading skeleton-loading-pulse';
        card.innerHTML = `
            <div class="outline-slide-number">${i + 1}</div>
            <div class="outline-slide-content">
                <div class="outline-slide-header">
                    <div class="outline-slide-title skeleton-loading-pulse"></div>
                    <div class="outline-slide-type-select skeleton-loading-pulse">Role</div>
                </div>
                <div class="outline-slide-desc skeleton-loading-pulse"></div>
                <div class="outline-points-list">
                    <div class="outline-point-item"><span class="outline-point-bullet">●</span><div class="outline-point-input skeleton-loading-pulse"></div></div>
                    <div class="outline-point-item"><span class="outline-point-bullet">●</span><div class="outline-point-input skeleton-loading-pulse"></div></div>
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
    
    if (window.__applyTranslations) window.__applyTranslations();
    
    document.getElementById('outline-container').classList.remove('hidden');
    
    const backdrop = document.getElementById('outline-backdrop');
    if (backdrop) backdrop.classList.add('active');
    
    const edgeTab = document.getElementById('outline-edge-tab');
    if (edgeTab) edgeTab.classList.add('hidden');
    
    // Update Hero Title in chat screen to say "Waiting for your review..."
    const heroTextSpan = document.querySelector('.hero-title-text');
    if (heroTextSpan) {
        if (!heroTextSpan.getAttribute('data-original-text')) {
            heroTextSpan.setAttribute('data-original-text', heroTextSpan.textContent);
        }
        heroTextSpan.textContent = window.__t('waiting_for_user', 'Waiting for your review...');
        heroTextSpan.parentElement.classList.add('waiting-state');
    }
    
    // Re-enable generate button and inputs
    document.getElementById('btn-outline-generate').disabled = false;
    
    // Populate settings
    const titleInput = document.getElementById('outline-title-input');
    titleInput.value = skeletonData.topic || '';
    titleInput.disabled = false;
    
    document.getElementById('outline-tone-select').value = skeletonData.tone || 'formal';
    document.getElementById('outline-audience-select').value = skeletonData.audience || 'general';
    document.getElementById('outline-density-select').value = skeletonData.density || 'medium';
    document.querySelectorAll('.outline-select').forEach(el => el.disabled = false);
    
    renderOutlineSlides();
}

function renderOutlineSlides() {
    const container = document.getElementById('outline-slides-container');
    container.innerHTML = '';
    
    const slides = window.outlineEditorState.skeleton.slides || [];
    
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
                    <select class="outline-slide-type-select" data-index="${index}">
                        <option value="cover" ${slide.role === 'cover' ? 'selected' : ''}>Cover</option>
                        <option value="problem" ${slide.role === 'problem' ? 'selected' : ''}>Problem</option>
                        <option value="concept" ${slide.role === 'concept' ? 'selected' : ''}>Concept</option>
                        <option value="data" ${slide.role === 'data' ? 'selected' : ''}>Data</option>
                        <option value="comparison" ${slide.role === 'comparison' ? 'selected' : ''}>Comparison</option>
                        <option value="process" ${slide.role === 'process' ? 'selected' : ''}>Process</option>
                        <option value="example" ${slide.role === 'example' ? 'selected' : ''}>Example</option>
                        <option value="error_list" ${slide.role === 'error_list' ? 'selected' : ''}>Error List</option>
                        <option value="quote" ${slide.role === 'quote' ? 'selected' : ''}>Quote</option>
                        <option value="timeline" ${slide.role === 'timeline' ? 'selected' : ''}>Timeline</option>
                        <option value="internals" ${slide.role === 'internals' ? 'selected' : ''}>Internals</option>
                        <option value="conclusion" ${slide.role === 'conclusion' ? 'selected' : ''}>Conclusion</option>
                    </select>
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
    
    // Helper for auto-resizing textareas
    const autoResizeTextarea = (el) => {
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = (el.scrollHeight) + 'px';
    };

    // Add event listeners for inputs
    document.querySelectorAll('.outline-slide-title').forEach(input => {
        autoResizeTextarea(input);
        input.addEventListener('input', (e) => {
            autoResizeTextarea(e.target);
            slides[e.target.dataset.index].title = e.target.value;
        });
    });
    document.querySelectorAll('.outline-slide-desc').forEach(input => {
        autoResizeTextarea(input);
        input.addEventListener('input', (e) => {
            autoResizeTextarea(e.target);
            slides[e.target.dataset.index].subtitle = e.target.value;
        });
    });
    document.querySelectorAll('.outline-slide-type-select').forEach(select => {
        select.addEventListener('change', (e) => {
            slides[e.target.dataset.index].role = e.target.value;
        });
    });
    document.querySelectorAll('.outline-point-input').forEach(input => {
        autoResizeTextarea(input);
        input.addEventListener('input', (e) => {
            autoResizeTextarea(e.target);
            const sIdx = e.target.dataset.sindex;
            const pIdx = e.target.dataset.pindex;
            slides[sIdx].key_points[pIdx] = e.target.value;
        });
    });
    document.querySelectorAll('.outline-point-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const btnEl = e.target.closest('.outline-point-delete');
            const sIdx = btnEl.dataset.sindex;
            const pIdx = btnEl.dataset.pindex;
            slides[sIdx].key_points.splice(pIdx, 1);
            renderOutlineSlides();
        });
    });
    document.querySelectorAll('.outline-slide-color-picker').forEach(picker => {
        picker.addEventListener('input', (e) => {
            const idx = e.target.dataset.index;
            slides[idx].bg_color = e.target.value;
            const card = e.target.closest('.outline-slide-card');
            const indicator = card.querySelector('.outline-slide-bg-indicator');
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
    
    // scroll to bottom
    const main = document.querySelector('.outline-main');
    main.scrollTop = main.scrollHeight;
}

async function addSlideWithAI() {
    const slides = window.outlineEditorState.skeleton.slides;
    if (slides.length >= window.outlineEditorState.maxSlides) return;
    
    const topic = document.getElementById('outline-title-input').value;
    
    const btn = document.getElementById('btn-add-slide-ai');
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Generating...';
    btn.disabled = true;
    
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
            const main = document.querySelector('.outline-main');
            main.scrollTop = main.scrollHeight;
        }
    } catch (e) {
        console.error(e);
        alert('Failed to generate slide. Please try again.');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

function addBlankPoint(slideIndex) {
    const slides = window.outlineEditorState.skeleton.slides;
    if (!slides[slideIndex].key_points) slides[slideIndex].key_points = [];
    slides[slideIndex].key_points.push("");
    renderOutlineSlides();
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
    renderOutlineSlides();
}

function moveSlideDown(index) {
    const slides = window.outlineEditorState.skeleton.slides;
    if (index === slides.length - 1) return;
    const temp = slides[index + 1];
    slides[index + 1] = slides[index];
    slides[index] = temp;
    renderOutlineSlides();
}

function resumeOutlineEditor() {
    if (!window.outlineEditorState.skeleton && !window.outlineEditorState.isLoading) return;
    
    if (window.__applyTranslations) window.__applyTranslations();
    
    document.getElementById('outline-container').classList.remove('hidden');
    
    const backdrop = document.getElementById('outline-backdrop');
    if (backdrop) backdrop.classList.add('active');
    
    const edgeTab = document.getElementById('outline-edge-tab');
    if (edgeTab) edgeTab.classList.add('hidden');
    
    const heroTextSpan = document.querySelector('.hero-title-text');
    if (heroTextSpan) {
        if (!heroTextSpan.getAttribute('data-original-text')) {
            heroTextSpan.setAttribute('data-original-text', heroTextSpan.textContent);
        }
        if (window.outlineEditorState.isLoading) {
            heroTextSpan.textContent = window.__t('generating_outline', 'Generating structure...');
        } else {
            heroTextSpan.textContent = window.__t('waiting_for_user', 'Waiting for your review...');
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

document.addEventListener('DOMContentLoaded', () => {
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
            const backdrop = document.getElementById('outline-backdrop');
            if (backdrop) backdrop.classList.remove('active');
            
            const heroTextSpan = document.querySelector('.hero-title-text');
            if (heroTextSpan && heroTextSpan.getAttribute('data-original-text')) {
                heroTextSpan.textContent = heroTextSpan.getAttribute('data-original-text');
                heroTextSpan.parentElement.classList.remove('waiting-state');
            }
            
            document.getElementById('outline-container').classList.add('hidden');
            
            // Show the floating edge tab
            const edgeTab = document.getElementById('outline-edge-tab');
            if (edgeTab) {
                edgeTab.classList.remove('hidden');
            }
            
            // optionally reset loading states in app.js
            if (window.hideLoadingState) window.hideLoadingState();
            if (window.disableGenerationUI) window.disableGenerationUI(false);
        });
    }
    
    // Backdrop click closes the drawer
    const backdrop = document.getElementById('outline-backdrop');
    if (backdrop && btnBack) {
        backdrop.addEventListener('click', () => {
            btnBack.click();
        });
    }
    
    // Edge tab opens the drawer
    const edgeTab = document.getElementById('outline-edge-tab');
    if (edgeTab) {
        edgeTab.addEventListener('click', () => {
            resumeOutlineEditor();
        });
    }
});
