/**
 * @typedef {Object} AttachmentDependencies
 * @property {HTMLButtonElement|null} btnAttachFile
 * @property {HTMLInputElement|null} fileUploadInput
 * @property {HTMLElement|null} attachmentPreviewContainer
 * @property {Function} validateGenerateButton
 */

/** Preserve the two page-level file navigation guards at bootstrap time. */
function createPageDropGuard() {
    // Prevent accidental browser navigation when dragging files over the page
    window.addEventListener('dragover', (e) => {
        const previewContainer = document.getElementById('preview-container');
        if (previewContainer && !previewContainer.classList.contains('hidden')) return; // Let editor handle its own dragover
        e.preventDefault();
    }, false);
    window.addEventListener('drop', (e) => {
        const previewContainer = document.getElementById('preview-container');
        if (previewContainer && !previewContainer.classList.contains('hidden')) return; // Let editor handle its own drop
        e.preventDefault();
    }, false);
}

/**
 * Register the chat attachment UI and file drag handlers in their original order.
 * @param {AttachmentDependencies} deps
 */
// eslint-disable-next-line max-lines-per-function -- Listener order and local drag state are preserved as one vertical block.
function createAttachments(deps) {
    const { btnAttachFile, fileUploadInput, attachmentPreviewContainer, validateGenerateButton } = deps;

    // Store files locally for submission
    window._attachedFiles = [];

    function handleFilesAdded(files) {
        if (files.length === 0) return;

        const allowedExtensions = ['.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg', '.webp'];
        const validFiles = [];
        for (const f of files) {
            const ext = f.name.includes('.') ? f.name.substring(f.name.lastIndexOf('.')).toLowerCase() : '';
            if (!allowedExtensions.includes(ext)) {
                const msg = window.__t('invalid_file_format', 'Invalid file format. Only PDF, Office Word, and images are allowed.');
                window.AedosModals.showNotice(msg);
                continue;
            }

            if (f.size > 10 * 1024 * 1024) {
                const msg = window.__t('file_too_large', 'The file "{name}" is too large. Maximum size is 10MB.').replace('{name}', f.name);
                window.AedosModals.showNotice(msg);
                continue;
            }
            validFiles.push(f);
        }

        if (window._attachedFiles.length + validFiles.length > 3) {
            window.AedosModals.showNotice(window.__t('max_files_reached', 'You can upload a maximum of 3 files per presentation.'));
            validFiles.splice(3 - window._attachedFiles.length);
        }

        if (validFiles.length > 0) {
            window._attachedFiles = window._attachedFiles.concat(validFiles);
            renderAttachmentChips();
            validateGenerateButton();
        }
    }

    if (btnAttachFile && fileUploadInput) {
        btnAttachFile.addEventListener('click', () => {
            fileUploadInput.click();
        });

        fileUploadInput.addEventListener('change', (e) => {
            const files = Array.from(e.target.files);
            handleFilesAdded(files);
            fileUploadInput.value = '';
        });
    }

    // ── Drag and Drop Event Listeners ───────────────────────────────────
    (function setupDragAndDrop() {
        let dragCounter = 0;
        const dragDropOverlay = document.getElementById('drag-drop-overlay');

        window.addEventListener('dragenter', (e) => {
            e.preventDefault();

            // Do not show full-screen drag overlay or allow global file attachment if editor is active
            const previewContainer = document.getElementById('preview-container');
            if (previewContainer && !previewContainer.classList.contains('hidden')) return;

            // Block drag and drop in chat mode
            const chatScreen = document.getElementById('chat-screen');
            if (chatScreen && chatScreen.classList.contains('chat-mode')) return;

            if (btnAttachFile && btnAttachFile.disabled) return;
            if (!e.dataTransfer || !e.dataTransfer.types.includes('Files')) return;

            dragCounter++;
            if (dragCounter === 1 && dragDropOverlay) {
                dragDropOverlay.classList.remove('hidden');
            }
        });

        window.addEventListener('dragover', (e) => {
            const previewContainer = document.getElementById('preview-container');
            if (previewContainer && !previewContainer.classList.contains('hidden')) return;

            // Block drag and drop in chat mode
            const chatScreen = document.getElementById('chat-screen');
            if (chatScreen && chatScreen.classList.contains('chat-mode')) return;

            e.preventDefault();
        });

        window.addEventListener('dragleave', (e) => {
            e.preventDefault();

            const previewContainer = document.getElementById('preview-container');
            if (previewContainer && !previewContainer.classList.contains('hidden')) {
                dragCounter = 0;
                if (dragDropOverlay) dragDropOverlay.classList.add('hidden');
                return;
            }

            dragCounter--;
            if (dragCounter <= 0) {
                dragCounter = 0;
                if (dragDropOverlay) dragDropOverlay.classList.add('hidden');
            }
        });

        window.addEventListener('drop', (e) => {
            e.preventDefault();

            const previewContainer = document.getElementById('preview-container');
            if (previewContainer && !previewContainer.classList.contains('hidden')) {
                dragCounter = 0;
                if (dragDropOverlay) dragDropOverlay.classList.add('hidden');
                return;
            }

            // Block drag and drop in chat mode
            const chatScreen = document.getElementById('chat-screen');
            if (chatScreen && chatScreen.classList.contains('chat-mode')) {
                dragCounter = 0;
                if (dragDropOverlay) dragDropOverlay.classList.add('hidden');
                return;
            }

            dragCounter = 0;
            if (dragDropOverlay) dragDropOverlay.classList.add('hidden');

            if (btnAttachFile && btnAttachFile.disabled) return;

            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                const files = Array.from(e.dataTransfer.files);
                handleFilesAdded(files);
            }
        });
    })();

    function renderAttachmentChips() {
        if (!attachmentPreviewContainer) return;

        if (typeof window._syncModeWithFiles === 'function') {
            window._syncModeWithFiles();
        }

        // Revoke any existing object URLs to prevent memory leaks
        const existingChips = attachmentPreviewContainer.querySelectorAll('.file-chip');
        existingChips.forEach(c => {
            if (c.dataset.objectUrl) URL.revokeObjectURL(c.dataset.objectUrl);
        });

        attachmentPreviewContainer.innerHTML = '';
        if (window._attachedFiles.length === 0) {
            attachmentPreviewContainer.classList.add('hidden');
            return;
        }

        attachmentPreviewContainer.classList.remove('hidden');

        window._attachedFiles.forEach((file, index) => {
            const chip = document.createElement('div');
            chip.className = 'file-chip';

            let iconMarkup = '';
            let isLucide = false;

            if (file.type.startsWith('image/')) {
                const objectUrl = URL.createObjectURL(file);
                iconMarkup = `<img src="${objectUrl}" alt="preview" style="width: 24px; height: 24px; object-fit: cover; border-radius: 4px; margin-right: 6px;">`;
                chip.dataset.objectUrl = objectUrl;
            } else if (file.type.includes('pdf') || file.name.endsWith('.pdf')) {
                // PDF Acrobat red flat icon
                iconMarkup = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" style="margin-right: 6px; flex-shrink: 0;"><path d="M4 2h10l6 6v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#E2231A"/><path d="M14 2v6h6z" fill="#B0150F"/><text x="11" y="16.5" fill="#FFFFFF" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="6.2" font-weight="900" text-anchor="middle" letter-spacing="-0.3px">PDF</text></svg>`;
            } else if (file.name.endsWith('.docx') || file.name.endsWith('.doc')) {
                // DOCX Word blue flat icon
                iconMarkup = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" style="margin-right: 6px; flex-shrink: 0;"><path d="M4 2h10l6 6v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="#185ABD"/><path d="M14 2v6h6z" fill="#103F8A"/><text x="11" y="16.5" fill="#FFFFFF" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="7.5" font-weight="900" text-anchor="middle">W</text></svg>`;
            } else {
                isLucide = true;
                iconMarkup = `<i data-lucide="file-text" style="width: 18px; height: 18px; margin-right: 6px; color: var(--text-color);"></i>`;
            }

            // Limit name length
            let displayName = file.name;
            if (displayName.length > 20) {
                displayName = displayName.substring(0, 17) + '...';
            }

            const nameSpan = document.createElement('span');
            nameSpan.style.display = 'flex';
            nameSpan.style.alignItems = 'center';
            nameSpan.innerHTML = `${iconMarkup} <span>${displayName}</span>`;

            if (isLucide) {
                setTimeout(() => {
                    if (window.lucide && typeof window.lucide.createIcons === 'function') {
                        window.lucide.createIcons({ root: nameSpan });
                    }
                }, 0);
            }

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'file-chip-remove';
            removeBtn.setAttribute('aria-label', 'Remove file');
            removeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

            removeBtn.addEventListener('click', () => {
                window._attachedFiles.splice(index, 1);
                renderAttachmentChips();
                validateGenerateButton();
            });

            chip.appendChild(nameSpan);
            chip.appendChild(removeBtn);
            attachmentPreviewContainer.appendChild(chip);
        });
    }
}

window.AedosAttachments = { createPageDropGuard, createAttachments };
