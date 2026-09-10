/// <reference types="vite/client" />

// `import.meta.env` é do Vite, não do TypeScript. Sem esta referência o typecheck do pacote
// não conhece o objeto — e o pacote SÓ passou a ser typechecado na FUN-22, então isto não
// existia antes por não ter quem reclamasse.
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /**
   * De onde vem o pacote de assets (FUN-23), com a versão no caminho — `/things/1332`.
   *
   * A versão fica no caminho desde o primeiro código, e não numa query: subir de versão com
   * caminho fixo invalidaria cache e trocaria ids ao mesmo tempo (§13.1).
   */
  readonly VITE_THINGS_URL?: string;
}
