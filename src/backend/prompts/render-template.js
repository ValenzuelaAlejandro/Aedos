'use strict';

// Static prompt text is data. Interpolations remain ordinary, reviewed JS;
// no expression from a template or user input is evaluated dynamically.
function renderTemplate(parts, values) {
    return parts.reduce((text, part, index) => text + (index ? String(values[index - 1]) : '') + part, '');
}
module.exports = { renderTemplate };
