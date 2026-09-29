import { describe, expect, it, vi } from 'vitest';
import { deployStaging } from './deploy-staging.js';

const sha = 'a'.repeat(40);
const env = {
  GITHUB_SHA: sha, GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: 'example/game',
  GH_TOKEN: 'github-test', COOLIFY_API_TOKEN: 'coolify-test', COOLIFY_APP_UUID: 'app123',
  COOLIFY_URL: 'https://coolify.example.com', APP_ORIGIN: 'https://staging.example.com',
  GAME_PUBLIC_URL: 'wss://staging.example.com/ws', POSTGRES_PASSWORD: 'a'.repeat(64),
  WORKOS_API_KEY: 'workos-test', WORKOS_CLIENT_ID: 'client-test',
};

function fixture(options: {
  head?: string; commit?: string; status?: string; envStatus?: number;
  /** Quantas vezes `/` responde 503 antes de subir. É a troca de contêiner do proxy. */
  flaky?: number;
} = {}) {
  let flaky = options.flaky ?? 0;
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes('api.github.com')) return Response.json({ sha: options.head ?? sha });
    if (url.endsWith('/envs/bulk')) {
      return Response.json({ value: 'sensitive-response-must-not-be-logged' }, { status: options.envStatus ?? 201 });
    }
    if (url.includes('/deploy?')) {
      // O duplo responde como o Coolify 4.2.0: endpoint que muda estado só aceita POST, e o
      // GET equivalente devolve 405. Aceitar qualquer método aqui era o que deixava o teste
      // passar com o script quebrado em produção.
      if (init?.method !== 'POST') return new Response('', { status: 405 });
      return Response.json({ deployments: [{ resource_uuid: 'app123', deployment_uuid: 'deploy123' }] });
    }
    if (url.includes('/deployments/')) return Response.json({ status: options.status ?? 'finished', commit: options.commit ?? sha });
    if (url.includes('/applications/')) return Response.json({ status: 'running:healthy' });
    if (url.endsWith('/api/auth/me')) return new Response('', { status: 401 });
    if (url === env.APP_ORIGIN + '/' && flaky > 0) {
      flaky -= 1;
      return new Response('', { status: 503 });
    }
    if (url.endsWith('/api/auth/login')) {
      return new Response(null, { status: 302, headers: {
        location: `https://api.workos.com/user_management/authorize?redirect_uri=${encodeURIComponent(env.APP_ORIGIN + '/api/auth/callback')}`,
      } });
    }
    return new Response('ok');
  });
  return { calls, dependencies: { fetch: fetchMock as typeof fetch, sleep: vi.fn(async () => {}) } };
}

describe('staging deployment', () => {
  it('pins the validated SHA, syncs runtime secrets and verifies the completed deployment', async () => {
    const { calls, dependencies } = fixture();
    await deployStaging(env, dependencies);
    const configuration = calls.find((call) => call.init?.method === 'PATCH')!;
    expect(JSON.parse(String(configuration.init?.body))).toEqual({
      git_branch: 'main', git_commit_sha: sha, is_auto_deploy_enabled: false,
    });
    const sync = calls.find((call) => call.url.endsWith('/envs/bulk'))!;
    const body = JSON.parse(String(sync.init?.body)) as { data: { key: string; is_buildtime: boolean; is_runtime: boolean }[] };
    expect(body.data.filter((item) => !item.is_buildtime).map((item) => item.key)).toEqual(['POSTGRES_PASSWORD', 'WORKOS_API_KEY']);
    expect(body.data.every((item) => item.is_runtime)).toBe(true);
    expect(calls.at(-1)?.url).toBe(`${env.APP_ORIGIN}/api/auth/login`);
  });

  it('does not mutate Coolify for a superseded main commit', async () => {
    const { calls, dependencies } = fixture({ head: 'b'.repeat(40) });
    await deployStaging(env, dependencies);
    expect(calls).toHaveLength(1);
  });

  it('retenta a falha de REDE três vezes, e nunca uma resposta HTTP', async () => {
    // Dois merges seguidos tiveram o primeiro `deploy` derrubado por "failed or timed out" e
    // o rerun manual aceito um minuto depois: o proxy do host fecha a conexão enquanto troca
    // um contêiner. Mutação que mata: `attempt >= 1` (uma tentativa só), ou retentar também
    // quando o `fetch` RESOLVE (o PATCH de segredos seria mandado duas vezes).
    const { calls, dependencies } = fixture();
    const inner = dependencies.fetch;
    let failures = 2;
    const flakyFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes('api.github.com') && failures > 0) {
        failures -= 1;
        throw new TypeError('fetch failed');
      }
      return inner(input, init);
    });
    await deployStaging(env, { ...dependencies, fetch: flakyFetch as typeof fetch });
    expect(flakyFetch.mock.calls.filter(([input]) => String(input).includes('api.github.com'))).toHaveLength(3);
    expect(dependencies.sleep).toHaveBeenCalledWith(10_000);
    // O deploy seguiu normalmente depois: o PATCH de segredos saiu UMA vez.
    expect(calls.filter((call) => call.url.endsWith('/envs/bulk'))).toHaveLength(1);

    // Três falhas seguidas é falha de verdade.
    const dead = fixture();
    const alwaysDown = vi.fn(async () => { throw new TypeError('fetch failed'); });
    await expect(deployStaging(env, { ...dead.dependencies, fetch: alwaysDown as unknown as typeof fetch }))
      .rejects.toThrow('Deployment request failed or timed out.');
    expect(alwaysDown).toHaveBeenCalledTimes(3);
  });

  it('rejects a non-main run before accessing secrets remotely', async () => {
    const { calls, dependencies } = fixture();
    await expect(deployStaging({ ...env, GITHUB_REF: 'refs/pull/69/merge' }, dependencies)).rejects.toThrow('requires a main commit');
    expect(calls).toHaveLength(0);
  });

  it('dispara o deploy com POST, porque o GET equivalente é 405 desde o Coolify 4.2.0', async () => {
    // O defeito que deixou o staging parado em SEIS entregas seguidas na `main`: as variáveis
    // eram sincronizadas, o commit era fixado no Coolify, e o build nunca começava.
    //
    // Ele era invisível de dentro de uma PR — o job de deploy só roda na `main` —, e o teste
    // não pegava porque o duplo aceitava qualquer método. Agora ele responde 405 ao GET, como
    // o Coolify de verdade.
    const { dependencies, calls } = fixture();
    await deployStaging(env, dependencies);

    const trigger = calls.find((call) => call.url.includes('/deploy?'));
    expect(trigger?.init?.method).toBe('POST');
  });

  it('does not deploy when secret synchronization fails or disclose the response body', async () => {
    const { calls, dependencies } = fixture({ envStatus: 403 });
    await expect(deployStaging(env, dependencies)).rejects.toThrow('returned HTTP 403');
    expect(calls.some((call) => call.url.includes('/deploy?'))).toBe(false);
  });

  it('rejects a successful deployment of the wrong commit', async () => {
    const { dependencies } = fixture({ commit: 'b'.repeat(40) });
    await expect(deployStaging(env, dependencies)).rejects.toThrow('does not match');
  });

  it('reports a failed build even if the previous application remains healthy', async () => {
    const { dependencies } = fixture({ status: 'failed' });
    await expect(deployStaging(env, dependencies)).rejects.toThrow('did not finish successfully');
  });

  it('bounds polling when Coolify never finishes the deployment', async () => {
    const { dependencies } = fixture({ status: 'in_progress' });
    await expect(deployStaging(env, dependencies)).rejects.toThrow('Timed out waiting');
    expect(dependencies.sleep).toHaveBeenCalledTimes(180);
  });
});

describe('a troca de contêiner (FUN-98)', () => {
  it('espera a rota pública subir em vez de reprovar o deploy que deu certo', async () => {
    // "Saudável" é a visão do Coolify sobre o contêiner; o proxy reverso ainda pode estar
    // trocando o upstream, e nesse instante a rota devolve 503. Reprovar por isso pinta de
    // vermelho uma entrega que funcionou — e pipeline vermelho sem motivo é pipeline que
    // ninguém mais lê.
    const { dependencies } = fixture({ flaky: 3 });
    await expect(deployStaging(env, dependencies)).resolves.toBeUndefined();
  });

  it('mas desiste, e o motivo é o ÚLTIMO status — não "falhou"', async () => {
    // Esperar não pode virar esperar para sempre: uma rota que nunca sobe é um deploy que não
    // serve, e quem lê o log precisa do número para saber onde procurar.
    const { dependencies } = fixture({ flaky: 999 });
    await expect(deployStaging(env, dependencies)).rejects.toThrow('HTTP 503');
  });
});
