import { setTimeout as delay } from 'node:timers/promises';

type Environment = Record<string, string | undefined>;
type Dependencies = { fetch: typeof fetch; sleep: (ms: number) => Promise<unknown> };

// Não registrar corpos de resposta: a API pode devolver os secrets recém-atualizados.
export async function deployStaging(
  env: Environment,
  dependencies: Dependencies = { fetch, sleep: delay },
): Promise<void> {
  const required = (name: string): string => {
    const value = env[name];
    if (!value) throw new Error(`Missing configuration: ${name}`);
    return value;
  };
  const sha = required('GITHUB_SHA');
  if (env.GITHUB_REF !== 'refs/heads/main' || !/^[a-f0-9]{40}$/.test(sha)) {
    throw new Error('Staging deployment requires a main commit.');
  }
  const origin = required('APP_ORIGIN');
  const coolify = required('COOLIFY_URL');
  for (const value of [origin, coolify]) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.origin !== value) {
      throw new Error('Deployment URLs must be HTTPS origins without a trailing slash.');
    }
  }
  if (required('GAME_PUBLIC_URL') !== `${origin.replace('https:', 'wss:')}/ws`) {
    throw new Error('GAME_PUBLIC_URL must use the staging origin.');
  }
  const uuid = required('COOLIFY_APP_UUID');
  if (!/^[a-z0-9]+$/.test(uuid)) throw new Error('Invalid Coolify application UUID.');
  const token = required('COOLIFY_API_TOKEN');
  const githubToken = required('GH_TOKEN');
  const repository = required('GITHUB_REPOSITORY');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid GitHub repository.');
  const variables = ['POSTGRES_PASSWORD', 'WORKOS_API_KEY', 'WORKOS_CLIENT_ID', 'APP_ORIGIN', 'GAME_PUBLIC_URL'];
  const data = variables.map((key) => ({
    key, value: required(key), is_preview: false, is_runtime: true,
    is_buildtime: !['POSTGRES_PASSWORD', 'WORKOS_API_KEY'].includes(key),
    is_literal: true,
  }));
  if (!/^[a-f0-9]{32,}$/.test(required('POSTGRES_PASSWORD'))) {
    throw new Error('POSTGRES_PASSWORD must contain at least 32 hexadecimal characters.');
  }

  const request = async (url: string, init: RequestInit = {}): Promise<Response> => {
    try {
      return await dependencies.fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    } catch {
      throw new Error('Deployment request failed or timed out.');
    }
  };
  const api = async (path: string, method = 'GET', body?: unknown): Promise<Record<string, unknown>> => {
    const response = await request(`${coolify}/api/v1${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`Coolify ${method} ${path} returned HTTP ${response.status}.`);
    try {
      return await response.json() as Record<string, unknown>;
    } catch {
      throw new Error(`Coolify ${method} ${path} returned invalid JSON.`);
    }
  };

  // Um CI antigo não pode sobrescrever um commit mais recente já publicado.
  const headResponse = await request(`https://api.github.com/repos/${repository}/commits/main`, {
    headers: { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github+json' },
  });
  if (!headResponse.ok) throw new Error(`GitHub main lookup returned HTTP ${headResponse.status}.`);
  const head = await headResponse.json() as { sha?: string };
  if (!head.sha) throw new Error('GitHub did not return the main commit SHA.');
  if (head.sha !== sha) {
    console.log('Skipping superseded main commit.');
    return;
  }

  const path = `/applications/${uuid}`;
  await api(path, 'PATCH', {
    git_branch: 'main', git_commit_sha: sha, is_auto_deploy_enabled: false,
  });
  await api(`${path}/envs/bulk`, 'PATCH', { data });
  console.log('Staging variables synchronized; runtime secrets are excluded from build arguments.');
  // **POST, e não GET.** A partir do Coolify 4.2.0, todo endpoint que MUDA ESTADO — `deploy`,
  // `start`, `stop`, `restart`, `enable`, `disable`, validação de servidor — exige POST, e o GET
  // equivalente responde 405. Com GET, o deploy de staging ficou quebrado em toda entrega na
  // `main`: as variáveis eram sincronizadas, o commit era fixado, e o build nunca começava.
  //
  // O sintoma era invisível de dentro de uma PR, porque este job não roda lá (`github.ref`).
  const result = await api(`/deploy?uuid=${uuid}`, 'POST');
  const deployments = result.deployments as { deployment_uuid?: string; resource_uuid?: string }[] | undefined;
  const deployment = deployments?.find((item) => item.resource_uuid === uuid);
  const deploymentId = deployment?.deployment_uuid;
  if (!deploymentId || !/^[a-z0-9]+$/.test(deploymentId)) {
    throw new Error('Coolify did not queue the requested deployment.');
  }
  console.log(`Waiting for deployment ${deploymentId} of ${sha}.`);
  let finished = false;
  for (let attempt = 0; attempt < 180; attempt++) {
    const state = await api(`/deployments/${deploymentId}`);
    if (state.status === 'finished') {
      if (state.commit !== sha) throw new Error('Deployed commit does not match the successful CI commit.');
      finished = true;
      break;
    }
    if (!['queued', 'in_progress'].includes(String(state.status))) {
      throw new Error(`Coolify deployment ${deploymentId} did not finish successfully.`);
    }
    await dependencies.sleep(5_000);
  }
  if (!finished) throw new Error(`Timed out waiting for deployment ${deploymentId}; inspect Coolify before retrying.`);

  let healthy = false;
  for (let attempt = 0; attempt < 24; attempt++) {
    const application = await api(path);
    if (application.status === 'running:healthy') { healthy = true; break; }
    await dependencies.sleep(5_000);
  }
  if (!healthy) throw new Error('Staging containers did not become healthy.');
  // As rotas públicas aceitam ESPERA, e não afrouxamento.
  //
  // "Saudável" é a visão do Coolify sobre o contêiner; o proxy reverso ainda pode estar
  // trocando o upstream, e nesse instante a rota devolve 503. O deploy funcionou — só a
  // verificação chegou cedo. Reprovar por isso pinta de vermelho uma entrega que deu certo, e
  // pipeline que fica vermelho sem motivo é pipeline que ninguém mais lê.
  //
  // O que NÃO muda é o critério: continua sendo o status exato. Só o prazo é que existe.
  const settle = async (
    label: string, attempt: () => Promise<string | null>,
  ): Promise<void> => {
    let last = 'nenhuma resposta';
    for (let tries = 0; tries < 12; tries++) {
      const failure = await attempt();
      if (failure === null) return;
      last = failure;
      await dependencies.sleep(5_000);
    }
    throw new Error(`Staging ${label} never settled: ${last}`);
  };

  for (const [route, expected] of [['/', 200], ['/healthz', 200], ['/api/auth/me', 401]] as const) {
    await settle(route, async () => {
      const response = await request(`${origin}${route}`);
      await response.body?.cancel();
      return response.status === expected ? null : `HTTP ${response.status}`;
    });
  }
  await settle('login', async () => {
    const login = await request(`${origin}/api/auth/login`);
    await login.body?.cancel();
    const location = new URL(login.headers.get('location') ?? origin);
    if (login.status !== 302) return `HTTP ${login.status}`;
    if (location.origin !== 'https://api.workos.com') return `redirected to ${location.origin}`;
    return location.searchParams.get('redirect_uri') === `${origin}/api/auth/callback`
      ? null
      : 'wrong callback in the WorkOS redirect';
  });
  console.log(`Staging deployment ${deploymentId} is healthy and HTTPS checks passed.`);
}

if (import.meta.main) {
  deployStaging(process.env).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Staging deployment failed.');
    process.exitCode = 1;
  });
}
