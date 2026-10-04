/** @typedef {{fontSize: string, fontFamily: string, color: string, lineHeight: string, textAlign: string, fontWeight: string, letterSpacing: string, textTransform: string, fontVariant: string, fontStyle: string, textDecoration: string}} EditorInheritedStyles */

/** Reads the inherited typography snapshot used when elements are normalized. @param {(element: Element) => CSSStyleDeclaration} getComputedStyle @returns {(element: Element) => EditorInheritedStyles} */
export function createEditorStyleSnapshot(getComputedStyle) {
    return function getInheritedStyles(element) {
        const style = getComputedStyle(element);
        return {
            fontSize: style.fontSize,
            fontFamily: style.fontFamily,
            color: style.color,
            lineHeight: style.lineHeight,
            textAlign: style.textAlign,
            fontWeight: style.fontWeight,
            letterSpacing: style.letterSpacing,
            textTransform: style.textTransform,
            fontVariant: style.fontVariant,
            fontStyle: style.fontStyle,
            textDecoration: style.textDecoration
        };
    };
}
