# Mobile runtime

Classic scripts in this folder adapt the desktop editor to touch navigation.
`nav-dots.js` mirrors desktop slide metadata into the bottom mobile navigation;
`bridge.js` initializes that mirror only on mobile, alongside touch gestures and
the drawer controls. The `AedosMobileNavDots` global is an internal loading
bridge and is not a public app API.
