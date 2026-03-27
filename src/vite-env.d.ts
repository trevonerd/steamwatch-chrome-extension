/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ITAD_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
