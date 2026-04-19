// Loaded as an external script into AI-generated presentation iframes.
// Retries lucide.createIcons() until the Lucide library is available,
// handling cases where the CDN script loads asynchronously.
(function tryLucide(retries) {
    if (window.lucide) {
        lucide.createIcons();
    } else if (retries > 0) {
        setTimeout(function () { tryLucide(retries - 1); }, 100);
    }
})(20);
