// Entrada do cliente sintético de carga (FUN-45).
//
//   pnpm load --sessions 1000 --mode detached --duration 10m
//   pnpm load --sessions 2000 --mode attached  --duration 10m --metrics http://127.0.0.1:7171
//
// Só a borda. Tudo o que dá para testar sem subir processo mora em `runner.ts`, `args.ts` e
// `report.ts` — importar qualquer um deles não executa nada.

import { runLoad } from './runner.js';

process.exitCode = await runLoad();
