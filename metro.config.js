const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Drizzle's Expo migrator imports the generated .sql files directly.
config.resolver.sourceExts.push('sql');

module.exports = config;
