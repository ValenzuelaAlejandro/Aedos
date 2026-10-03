/**
 * Creates the existing shape and icon insertion operations for the editor.
 * The adapter keeps iframe selection and editor history calls at the boundary.
 *
 * @typedef {object} AedosEditorInsertionsOptions
 * @property {Document} iframeDoc
 * @property {Window & {editorSaveState?: () => void, editorSelect?: (element: Element) => void, editorUpdateSelection?: () => void, lucide?: {createIcons: () => void}}} iframeWin
 * @property {() => Element} getActiveSlide
 *
 * @typedef {object} AedosEditorInsertionsApi
 * @property {(className: string, styles: string) => void} insertShape
 * @property {(iconName: string) => void} insertIcon
 */

/**
 * @param {AedosEditorInsertionsOptions} options
 * @returns {AedosEditorInsertionsApi}
 */
function createAedosEditorInsertions({ iframeDoc, iframeWin, getActiveSlide }) {
    function selectInsertedElement(element) {
        if (iframeWin.editorSelect) {
            iframeWin.editorSelect(element);
        } else {
            const clickEvent = new MouseEvent('mousedown', {
                bubbles: true,
                cancelable: true,
                view: iframeWin,
            });
            element.dispatchEvent(clickEvent);
            const upEvent = new MouseEvent('mouseup', {
                bubbles: true,
                cancelable: true,
                view: iframeWin,
            });
            iframeDoc.dispatchEvent(upEvent);
        }

        if (iframeWin.editorUpdateSelection) iframeWin.editorUpdateSelection();
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

        // Split styles and apply manually.
        if (styles) {
            const customStyles = styles.split(';').filter((style) => style.trim());
            customStyles.forEach((style) => {
                const parts = style.split(':');
                const property = parts.shift();
                const value = parts.join(':');
                if (property && value) {
                    shape.style.setProperty(property.trim(), value.trim());
                }
            });
        }

        slide.appendChild(shape);
        selectInsertedElement(shape);
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

        // Lucide can replace the <i>; select the rendered icon when present.
        const newlyCreated = slide.querySelector(`[data-lucide="${iconName}"]`);
        selectInsertedElement(newlyCreated || icon);
    }

    return { insertShape, insertIcon };
}

window.AedosEditorInsertions = Object.freeze({ create: createAedosEditorInsertions });
