// Metro config for web: stub Node-only modules
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver = config.resolver || {};
const origResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web') {
    const stub = require.resolve('./src/lib/pdfkit-stub.js');
    if (
      moduleName === 'pdfkit' || moduleName.startsWith('pdfkit/') ||
      moduleName === 'fontkit' || moduleName === 'png-js' || moduleName === 'brotli' ||
      moduleName === 'expo-sqlite' || moduleName === 'expo-sqlite/next' ||
      moduleName === '@react-pdf/renderer' || moduleName.startsWith('@react-pdf/') ||
      moduleName === 'bidi-js' || moduleName === 'unicode-properties' ||
      moduleName === '@opentelemetry/api'
    ) {
      return { filePath: stub, type: 'sourceFile' };
    }
    if (moduleName.includes('@react-pdf/hyphenate')) {
      return { filePath: stub, type: 'sourceFile' };
    }
  }
  // drizzle-orm 0.33 imports the removed expo-sqlite/next subpath (SDK 52 /
  // expo-sqlite 15 merged it into the main entry) — alias it for native.
  if (moduleName === 'expo-sqlite/next') {
    return { filePath: require.resolve('expo-sqlite'), type: 'sourceFile' };
  }
  if (origResolve) return origResolve(context, moduleName, platform);
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
