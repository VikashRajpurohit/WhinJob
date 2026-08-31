module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Drizzle's Expo migrator imports .sql files as strings; Metro would otherwise
    // hand them to the JS parser. Path aliases still come from tsconfig.json, not Babel.
    plugins: [['inline-import', { extensions: ['.sql'] }]],
  };
};
