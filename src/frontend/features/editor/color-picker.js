/** @typedef {{document: Document, window: Window, getSelectedElement: () => Element|null, getActiveColorAction: () => ('text'|'bg'|null), saveState: () => void}} AedosEditorColorPickerOptions */

/** Creates the editor's dynamic presentation palette and swatch picker. @param {AedosEditorColorPickerOptions} options */
export function createEditorColorPicker({ document, window, getSelectedElement, getActiveColorAction, saveState }) {
    function getDynamicPalette() {
        const colors = new Set();
        const rootStyle = window.getComputedStyle(document.documentElement);
        const vars = ['--presentation-accent', '--accent', '--accent-2', '--bg', '--surface'];
        vars.forEach(v => {
            const val = rootStyle.getPropertyValue(v).trim();
            if (val && val !== 'none' && val !== 'transparent') colors.add(val);
        });

        const selectedElement = getSelectedElement();
        const slide = selectedElement?.closest('.s') || document.body;
        const allInSlide = slide.querySelectorAll('*');
        allInSlide.forEach(el => {
            if (colors.size >= 8) return;
            const style = window.getComputedStyle(el);
            if (style.color && !style.color.includes('rgba(0, 0, 0, 0)') && style.color !== 'transparent') colors.add(style.color);
            if (style.backgroundColor && !style.backgroundColor.includes('rgba(0, 0, 0, 0)') && style.backgroundColor !== 'transparent') colors.add(style.backgroundColor);
        });

        colors.add('#FFFFFF');
        colors.add('#000000');
        colors.add('#5D5DFF');
        colors.add('#FF5D5D');
        colors.add('#5DFF5D');
        return Array.from(colors).slice(0, 16);
    }

    function showColorPicker(anchorEl) {
        const picker = document.getElementById('editor-color-picker');
        const isCurrentlyVisible = picker.style.display === 'grid';
        if (isCurrentlyVisible && picker.dataset.anchor === anchorEl.id) {
            picker.style.display = 'none';
            return;
        }

        const palette = getDynamicPalette();
        picker.innerHTML = palette.map(color => `
            <div class="editor-color-swatch" style="background:${color};" data-color="${color}"></div>
        `).join('') + `
            <div class="editor-color-swatch" style="background:transparent; border: 1px dashed #ccc; display:flex; align-items:center; justify-content:center; font-size:10px; color:#999;" data-color="transparent">✕</div>
        `;

        picker.querySelectorAll('.editor-color-swatch').forEach(swatch => {
            swatch.addEventListener('click', e => {
                e.stopPropagation();
                const selectedElement = getSelectedElement();
                const activeColorAction = getActiveColorAction();
                if (selectedElement && activeColorAction) {
                    saveState();
                    const color = swatch.dataset.color;
                    if (activeColorAction === 'text') {
                        selectedElement.style.color = color;
                        selectedElement.style.webkitTextFillColor = color;
                        const icons = selectedElement.querySelectorAll('svg, [data-lucide]');
                        if (icons) icons.forEach(i => i.style.color = color);
                    } else if (activeColorAction === 'bg') {
                        selectedElement.style.background = color;
                    }
                    picker.style.display = 'none';
                }
            });
        });

        picker.style.display = 'grid';
        picker.dataset.anchor = anchorEl.id;
    }

    return { getDynamicPalette, showColorPicker };
}
