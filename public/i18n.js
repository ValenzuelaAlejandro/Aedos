const translations = {
    en: {
        "app_subtitle": "Generate a full presentation about...",
        "app_microcopy": "8–12 slides &middot; Structured content &middot; Ready to download as PDF",
        "tema_error": "Please enter a topic to generate your presentation.",
        "debug_canva": "Debug",
        "untitled_draft": "Untitled draft",
        "presentation_name": "Presentation name",
        "undo": "Undo (⌘Z)",
        "redo": "Redo (⌘Y)",
        "present": "Present",
        "regenerate": "Regenerate",
        "new_btn": "New",
        "download_pdf": "Download PDF",
        "add_slide": "Add slide",
        "add_text": "Add Text",
        "text": "Text",
        "add_image": "Add Image",
        "image": "Image",
        "add_shape": "Add Shape",
        "shape": "Shape",
        "add_icon": "Add Icon",
        "icon": "Icon",
        "empty_tools": "Select an element on the canvas, or click the background to change global settings.",
        "result_title": "Your presentation is ready!",
        "result_subtitle": "Slides were generated about your topic.",
        "generate_another": "Generate another presentation",
        "error_title": "Something didn't go as planned",
        "error_subtitle": "The AI service is temporarily unavailable. This is usually resolved quickly.",
        "error_summary": "Technical details",
        "try_again": "Try again",
        "refused_title": "This topic can't be generated",
        "refused_subtitle": "The AI declined to create this presentation for safety reasons.",
        "try_different": "Try a different topic",
        "fit": "Fit",
        "slide": "Slide",
        "background_color": "Background Color",
        "select_icon": "Select Icon",
        "select_shape": "Select Shape",
        "essentials": "Essentials",
        "communication": "Communication",
        "business": "Business",
        "multimedia": "Multimedia",
        "technology": "Technology",
        "social": "Social",
        "navigation": "Navigation",
        "nature": "Nature",
        "objects": "Objects",
        "square": "Square",
        "circle": "Circle",
        "diamond": "Diamond",
        "triangle": "Triangle",
        "hexagon": "Hexagon",
        "capsule": "Capsule",
        "text_tool": "Text",
        "size": "Size",
        "alignment": "Alignment",
        "color": "Color",
        "image_tool": "Image",
        "replace_image": "Replace Image",
        "border_radius": "Border Radius",
        "opacity": "Opacity",
        "icon_tool": "Icon",
        "icon_color": "Icon Color",
        "shape_tool": "Shape",
        "fill_color": "Fill Color",
        "border_color": "Border Color",
        "advanced": "Advanced",
        "bring_to_front": "Bring to Front",
        "send_to_back": "Send to Back",
        "delete_element": "Delete Element",
        "loading-text": "Shaping your ideas...",
        "refused_msg": "This topic cannot be generated.",
        "t-error-saturated": "The service is currently overloaded due to high demand. Please try again in a few minutes."
    },
    es: {
        "app_subtitle": "Generar una presentación completa sobre...",
        "app_microcopy": "8–12 diapositivas &middot; Contenido estructurado &middot; Lista para descargar en PDF",
        "tema_error": "Por favor ingresa un tema para generar tu presentación.",
        "debug_canva": "Depurar",
        "untitled_draft": "Borrador sin título",
        "presentation_name": "Nombre de la presentación",
        "undo": "Deshacer (⌘Z)",
        "redo": "Rehacer (⌘Y)",
        "present": "Presentar",
        "regenerate": "Regenerar",
        "new_btn": "Nuevo",
        "download_pdf": "Descargar PDF",
        "add_slide": "Agregar diapositiva",
        "add_text": "Agregar Texto",
        "text": "Texto",
        "add_image": "Agregar Imagen",
        "image": "Imagen",
        "add_shape": "Agregar Forma",
        "shape": "Forma",
        "add_icon": "Agregar Ícono",
        "icon": "Ícono",
        "empty_tools": "Selecciona un elemento en el lienzo, o haz clic en el fondo para cambiar ajustes globales.",
        "result_title": "¡Tu presentación está lista!",
        "result_subtitle": "Se generaron las diapositivas sobre tu tema.",
        "generate_another": "Generar otra presentación",
        "error_title": "Algo no salió como planeábamos",
        "error_subtitle": "El servicio de IA no está disponible temporalmente. Normalmente se resuelve rápido.",
        "error_summary": "Detalles técnicos",
        "try_again": "Intentar de nuevo",
        "refused_title": "Este tema no puede ser generado",
        "refused_subtitle": "La IA se rehusó a crear esta presentación por motivos de seguridad.",
        "try_different": "Intenta con un tema diferente",
        "fit": "Ajustar",
        "slide": "Diapositiva",
        "background_color": "Color de fondo",
        "select_icon": "Seleccionar Ícono",
        "select_shape": "Seleccionar Forma",
        "essentials": "Esenciales",
        "communication": "Comunicación",
        "business": "Negocios",
        "multimedia": "Multimedia",
        "technology": "Tecnología",
        "social": "Social",
        "navigation": "Navegación",
        "nature": "Naturaleza",
        "objects": "Objetos",
        "square": "Cuadrado",
        "circle": "Círculo",
        "diamond": "Diamante",
        "triangle": "Triángulo",
        "hexagon": "Hexágono",
        "capsule": "Cápsula",
        "text_tool": "Texto",
        "size": "Tamaño",
        "alignment": "Alineación",
        "color": "Color",
        "image_tool": "Imagen",
        "replace_image": "Reemplazar Imagen",
        "border_radius": "Radio de Borde",
        "opacity": "Opacidad",
        "icon_tool": "Ícono",
        "icon_color": "Color del Ícono",
        "shape_tool": "Forma",
        "fill_color": "Color de relleno",
        "border_color": "Color de borde",
        "advanced": "Avanzado",
        "bring_to_front": "Traer al frente",
        "send_to_back": "Enviar al fondo",
        "delete_element": "Eliminar Elemento",
        "loading-text": "Dando forma a tus ideas…",
        "refused_msg": "Este tema no puede ser generado.",
        "t-error-saturated": "El servicio está saturado en este momento debido a la alta demanda. Por favor, intenta de nuevo en unos minutos."
    }
};

window.currentLang = navigator.language.startsWith('es') ? 'es' : 'en';

window.t = function(key, defaultText = null) {
    let result = key;
    if (translations[currentLang] && translations[currentLang][key]) {
        result = translations[currentLang][key];
    } else if (translations['en'][key]) {
        result = translations['en'][key];
    } else if (defaultText !== null) {
        result = defaultText;
    }
    return result;
};

// Initialize DOM elements with translations
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        el.innerHTML = window.t(key);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        el.title = window.t(key);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        el.placeholder = window.t(key);
    });
    document.querySelectorAll('[data-i18n-val]').forEach(el => {
        const key = el.getAttribute('data-i18n-val');
        el.value = window.t(key);
    });
});
