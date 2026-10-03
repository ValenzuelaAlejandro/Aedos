/** @typedef {{ name: string, probe: string, file: string, edits: Array<[string, string]>, expected: Record<string, unknown> }} MutationSpec */

const specs = [
    {
        name: 'outline-add', probe: 'add', file: '/scripts/outline.js',
        edits: [['function addBlankSlide() {\n    const slides', 'function addBlankSlide() {\n    return;\n    const slides']],
        expected: { count: 4 },
    },
    {
        name: 'outline-title', probe: 'title', file: '/features/outline/editor-bindings.js',
        edits: [['slides[idx].title = e.target.value;', 'slides[idx].title = slides[idx].title;']],
        expected: { title: 'Mutation title sentinel' },
    },
    {
        name: 'outline-point', probe: 'point', file: '/features/outline/editor-bindings.js',
        edits: [['slides[sIdx].key_points[pIdx] = e.target.value;', 'slides[sIdx].key_points[pIdx] = slides[sIdx].key_points[pIdx];']],
        expected: { point: 'Mutation point sentinel' },
    },
    {
        name: 'outline-delete', probe: 'delete', file: '/scripts/outline.js',
        edits: [['window.outlineEditorState.skeleton.slides.splice(index, 1);', 'window.outlineEditorState.skeleton.slides.splice(index + 1, 1);']],
        expected: { count: 2, first: 'De panel a red eléctrica' },
    },
    {
        name: 'outline-move-up', probe: 'up', file: '/scripts/outline.js',
        edits: [['slides[index - 1] = slides[index];', 'slides[index - 1] = slides[index - 1];']],
        expected: { titles: ['De panel a red eléctrica', 'La energía que llega del sol', 'Ciudades con energía limpia'] },
    },
    {
        name: 'outline-move-down', probe: 'down', file: '/scripts/outline.js',
        edits: [['slides[index + 1] = slides[index];', 'slides[index + 1] = slides[index + 1];']],
        expected: { titles: ['De panel a red eléctrica', 'La energía que llega del sol', 'Ciudades con energía limpia'] },
    },
    {
        name: 'outline-finalize-sse', probe: 'finalize', file: '/scripts/app.js',
        edits: [['window.finalizeStreamingOutline(finalSkeleton);', 'window.finalizeStreamingOutline({ slides: [] });']],
        expected: { count: 3 },
    },
    {
        name: 'app-empty-validation', probe: 'validation', file: '/scripts/app.js',
        edits: [['const isActive = val.length >= 4 || hasFiles;', 'const isActive = true;']],
        expected: { disabled: true },
    },
    {
        name: 'app-http-error-status', probe: 'error', file: '/scripts/app.js',
        edits: [['if (!skeletonResponse.ok) {', 'if (false && !skeletonResponse.ok) {']],
        expected: { message: 'MOCK_HTTP_429', visible: true },
    },
    {
        name: 'app-preview-render', probe: 'preview', file: '/scripts/app.js',
        edits: [["doc.write('<!DOCTYPE html>' + html);", "doc.write('<!DOCTYPE html>' + html.replace(/<section/g, '<div').replace(/<\\/section>/g, '</div>'));" ]],
        expected: { count: 2 },
    },
    {
        name: 'editor-selection-bridge', probe: 'selection', file: '/editor/editor.js',
        edits: [['window.editorSelect = selectElement;', 'window.editorSelect = () => {};']],
        expected: { selected: 'H1' },
    },
    {
        name: 'editor-undo-bridge', probe: 'undo', file: '/editor/editor.js',
        edits: [['window.editorUndo = undo;', 'window.editorUndo = () => {};']],
        expected: { restored: true },
    },
    {
        name: 'tools-layer-up', probe: 'layer', file: '/features/tools/tools.js',
        edits: [['iframeWin.toFront && iframeWin.toFront()', 'void 0']],
        expected: { raised: true },
    },
];

module.exports = specs;
