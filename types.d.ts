/** Drizzle's Expo migrator imports generated migrations as modules (see metro.config.js). */
declare module '*.sql' {
  const content: string;
  export default content;
}
