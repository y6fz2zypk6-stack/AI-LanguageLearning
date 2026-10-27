/** ビルド時に scripts/build.mjs が差し込む（--watch のときだけ true） */
declare const __DEV__: boolean;

/** main.tsx の CSS の読み込み（esbuild が束ねる） */
declare module '*.css';
