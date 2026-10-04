# Modal feature

`error-modal.js` owns the error modal's callback and 190 ms close-transition
lifecycle. It receives the existing modal container and returns show, hide,
dismiss, and callback-reset operations; markup, classes, and appearance remain
owned by the page stylesheet and HTML.

The same module exposes `createRefusedModalClose({refusedContainer, chatScreen})`
for the refused response's existing 190 ms close transition.
