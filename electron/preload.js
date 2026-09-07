// FieldOps preload — contextIsolation bridge (no node access in renderer)
// Expo SecureStore → localStorage fallback is handled in JS; this is a minimal bridge for future native APIs
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('fieldops', {
  platform: process.platform,
  version: require('../package.json').version,
  isDesktop: true,
});
