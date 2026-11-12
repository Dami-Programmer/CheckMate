// esbuild loads .css files as plain text (see build.mjs).
declare module "*.css" {
  const text: string;
  export default text;
}

// esbuild inlines .png files as data URLs (see build.mjs).
declare module "*.png" {
  const url: string;
  export default url;
}
