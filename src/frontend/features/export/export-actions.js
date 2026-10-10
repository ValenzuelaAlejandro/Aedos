(function registerExportActions(global) {
    'use strict';

    /**
     * @typedef {Object} ExportActionDependencies
     * @property {HTMLButtonElement} finalizeBtn Existing finalize control.
     * @property {HTMLElement} errorMessage Existing export error message node.
     * @property {Object} previewState Current iframe and title.
     * @property {Object} generationState Requested output format.
     * @property {(onDismiss?: Function|null) => void} showErrorModal Existing modal action.
     */

    /** Register the current PDF/PPTX flow and download listener in place. @param {ExportActionDependencies} deps */
    function createExportActions({ finalizeBtn, errorMessage, previewState, generationState, showErrorModal }) {
        const progressModal = document.getElementById('export-progress-modal');
        const progressText = document.getElementById('export-progress-format');
        const donationModal = document.getElementById('donation-modal');
        const closeDonationModal = () => {
            donationModal?.classList.add('hidden');
            document.getElementById('export-menu-trigger')?.focus();
        };
        document.getElementById('donation-modal-close')?.addEventListener('click', closeDonationModal);
        document.getElementById('donation-dismiss')?.addEventListener('click', closeDonationModal);
        donationModal?.querySelector('.app-modal-backdrop')?.addEventListener('click', closeDonationModal);
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !donationModal?.classList.contains('hidden')) closeDonationModal();
        });
        // =========================================================
        // 9. FINALIZE — Download PDF or editable PowerPoint
        // =========================================================
        // eslint-disable-next-line complexity -- Keep the existing export lifecycle in one ordered listener.
        finalizeBtn.addEventListener('click', async () => {
            const exportFormat = generationState.requestedExportFormat;
            generationState.requestedExportFormat = 'pdf';
            finalizeBtn.disabled = true;
            finalizeBtn.classList.add('loading');
            if (progressText) progressText.textContent = window.__t(exportFormat === 'pptx' ? 'export_pptx_progress' : 'export_pdf_progress');
            progressModal?.classList.remove('hidden');
    
            try {
                const finalHtml = window.AedosExportSnapshot.createHtml(previewState.previewIframe);
    
                const response = await fetch(exportFormat === 'pptx' ? '/finalize-pptx' : '/finalize', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ html: finalHtml, title: previewState.currentTitle })
                });
    
                const data = await response.json();
    
                const downloadUrl = exportFormat === 'pptx' ? data.pptxUrl : data.pdfUrl;
                if (response.ok && downloadUrl) {
                    const link = document.createElement('a');
                    link.href = downloadUrl;
                    link.setAttribute('download', '');
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    progressModal?.classList.add('hidden');
                    donationModal?.classList.remove('hidden');
                    document.getElementById('donation-dismiss')?.focus();
                } else {
                    throw new Error(data.error || 'Error generating PDF');
                }
    
            } catch (error) {
                // Export error: overlay the preview WITHOUT hiding it
                errorMessage.textContent = error.message;
                const errTitleEl = document.getElementById('t-error-title');
                const errSubtitleEl = document.getElementById('t-error-subtitle');
                const errorTitle = exportFormat === 'pptx' ? 'PowerPoint could not be generated' : 'PDF could not be generated';
                const errorSubtitle = exportFormat === 'pptx' ? 'Something went wrong while creating the editable file. Your presentation is still there — you can try again.' : 'Something went wrong while creating the file. Your presentation is still there — you can try again.';
                if (errTitleEl) errTitleEl.textContent = window.__t ? window.__t(exportFormat === 'pptx' ? 'pptx_error_title' : 'pdf_error_title', errorTitle) : errorTitle;
                if (errSubtitleEl) errSubtitleEl.textContent = window.__t ? window.__t(exportFormat === 'pptx' ? 'pptx_error_subtitle' : 'pdf_error_subtitle', errorSubtitle) : errorSubtitle;
                // Dismiss just closes the modal — the user stays in the editor
                showErrorModal(null);
            } finally {
                progressModal?.classList.add('hidden');
                finalizeBtn.disabled = false;
                finalizeBtn.classList.remove('loading');
            }
        });
    }

    global.AedosExport = global.AedosExport || {};
    global.AedosExport.createExportActions = createExportActions;
})(window);
