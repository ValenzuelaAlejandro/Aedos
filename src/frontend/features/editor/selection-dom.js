/** Creates the existing selection UI nodes and their idempotent DOM attachment. @param {{document: Document}} options */
export function createEditorSelectionDom({ document }) {
    const selectionBox = document.createElement('div');
    selectionBox.className = 'editor-selection-box';
    selectionBox.style.display = 'none';
    selectionBox.style.zIndex = '1000';

    const handles = ['nw', 'ne', 'sw', 'se', 'n', 'e', 's', 'w'];
    const handleEls = {};
    handles.forEach(pos => {
        const handle = document.createElement('div');
        handle.className = `editor-resize-handle editor-resize-${pos}`;
        handle.dataset.handler = pos;
        selectionBox.appendChild(handle);
        handleEls[pos] = handle;
    });

    const toolbar = document.createElement('div');
    toolbar.className = 'editor-toolbar';
    toolbar.style.display = 'none';
    toolbar.style.zIndex = '1001';

    const guideH = document.createElement('div');
    guideH.className = 'editor-guide editor-guide-h';
    const guideV = document.createElement('div');
    guideV.className = 'editor-guide editor-guide-v';

    function ensureUI() {
        if (!selectionBox.parentElement) document.documentElement.appendChild(selectionBox);
        if (!toolbar.parentElement) document.documentElement.appendChild(toolbar);
        if (!guideH.parentElement) document.documentElement.appendChild(guideH);
        if (!guideV.parentElement) document.documentElement.appendChild(guideV);
    }

    return { selectionBox, handleEls, toolbar, guideH, guideV, ensureUI };
}
