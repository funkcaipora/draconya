/// <reference types="vite/client" />

// `import.meta.env` é do Vite, não do TypeScript. Sem esta referência o typecheck do pacote
// não conhece o objeto — e o pacote SÓ passou a ser typechecado na FUN-22, então isto não
// existia antes por não ter quem reclamasse.
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
}
