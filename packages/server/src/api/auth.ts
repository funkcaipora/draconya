import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Configuration } from '../config.js';
import { clearCookie, clearCookieAtPath, readCookie, serializeCookie } from '../auth/cookies.js';
import {
  AUTHORIZATION_STATE_TTL_SECONDS,
  AuthService,
  SESSION_COOKIE,
  STATE_COOKIE,
} from '../auth/service.js';

const DevLoginBody = z.object({ email: z.string().email().max(254) }).strict();
const AuthorizationState = z.string().regex(/^[A-Za-z0-9_-]{32}$/);
const CallbackQuery = z.union([
  z.object({ code: z.string().min(1).max(2_048), state: AuthorizationState }).strict(),
  z.object({
    error: z.string().min(1).max(128),
    error_description: z.string().max(1_024).optional(),
    state: AuthorizationState,
  }).strict(),
]);
const STATE_COOKIE_PATH = '/api/auth/callback';

export function registerAuthRoutes(
  app: FastifyInstance,
  configuration: Configuration,
  auth: AuthService,
): void {
  const secure = configuration.NODE_ENV === 'production';
  const sessionCookie = (token: string): string => serializeCookie(SESSION_COOKIE, token, {
    secure,
    maxAgeSeconds: configuration.AUTH_SESSION_TTL_SECONDS,
  });

  const begin = (screen: 'sign-in' | 'sign-up') => async (
    _request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    if (auth.devMode) {
      return reply.code(400).send({ error: 'use-dev-login' });
    }
    if (!auth.hostedConfigured) {
      return reply.code(503).send({ error: 'auth-provider-not-configured' });
    }
    const authorization = await auth.createAuthorization(screen);
    reply.header('set-cookie', serializeCookie(STATE_COOKIE, authorization.state, {
      secure,
      path: STATE_COOKIE_PATH,
      maxAgeSeconds: AUTHORIZATION_STATE_TTL_SECONDS,
    }));
    return reply.redirect(authorization.url);
  };

  app.get('/api/auth/login', begin('sign-in'));
  app.get('/api/auth/register', begin('sign-up'));

  app.get('/api/auth/callback', async (request, reply) => {
    if (auth.devMode) return reply.code(404).send({ error: 'not-found' });
    if (!auth.hostedConfigured) {
      return reply.code(503).send({ error: 'auth-provider-not-configured' });
    }
    const query = CallbackQuery.safeParse(request.query);
    if (!query.success) {
      reply.header('set-cookie', clearCookieAtPath(STATE_COOKIE, secure, STATE_COOKIE_PATH));
      return reply.code(400).send({ error: 'invalid-callback' });
    }
    const expectedState = readCookie(request.headers.cookie, STATE_COOKIE);
    if (expectedState === null || expectedState !== query.data.state) {
      reply.header('set-cookie', clearCookieAtPath(STATE_COOKIE, secure, STATE_COOKIE_PATH));
      return reply.code(400).send({ error: 'invalid-state' });
    }
    const unusedState = await auth.consumeAuthorizationState(query.data.state);
    reply.header('set-cookie', clearCookieAtPath(STATE_COOKIE, secure, STATE_COOKIE_PATH));
    if (!unusedState) return reply.code(400).send({ error: 'invalid-state' });
    if ('error' in query.data) {
      return reply.code(400).send({ error: 'authentication-failed' });
    }

    const userAgent = request.headers['user-agent'];
    const result = await auth.completeHostedLogin(query.data.code, {
      ip: request.ip,
      ...(typeof userAgent === 'string' ? { userAgent } : {}),
    }, readCookie(request.headers.cookie, SESSION_COOKIE) ?? undefined);
    reply.header('set-cookie', sessionCookie(result.token));
    return reply.redirect(configuration.API_ORIGIN);
  });

  app.post('/api/auth/dev-login', async (request, reply) => {
    if (!auth.devMode) return reply.code(404).send({ error: 'not-found' });
    const body = DevLoginBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid-body' });
    const result = await auth.devLogin(
      body.data.email,
      readCookie(request.headers.cookie, SESSION_COOKIE) ?? undefined,
    );
    reply.header('set-cookie', sessionCookie(result.token));
    return reply.send({
      accountId: result.session.accountId,
      email: result.session.email,
    });
  });

  app.get('/api/auth/me', async (request, reply) => {
    const principal = await auth.authenticate(request);
    if (principal === null) return reply.code(401).send({ error: 'unauthenticated' });
    return reply.send(principal);
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const redirectTo = await auth.logout(request, configuration.API_ORIGIN);
    reply.header('set-cookie', clearCookie(SESSION_COOKIE, secure));
    return reply.send({ redirectTo });
  });
}
