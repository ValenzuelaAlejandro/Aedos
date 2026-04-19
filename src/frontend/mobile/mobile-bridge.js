(function () {
    if (window.__mobileBridgeLegacyLoaded) return;
    window.__mobileBridgeLegacyLoaded = true;
    const script = document.createElement('script');
    script.src = 'mobile/js/bridge.js?v=2';
    script.defer = true;
    document.head.appendChild(script);
})();
