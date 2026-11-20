/**
 * Deployment identity shared by every surface that reports which build is running.
 *
 * Build-time facts (commit, ref, build id) are inlined by next.config.js; these are
 * the runtime facts a server route has to read per request instead.
 */

/** Short labels for the deployment environment, shown to operators. */
const ENVIRONMENT_LABELS = {
  production: 'prod',
  preview: 'preview',
  staging: 'staging',
  development: 'dev',
  test: 'test',
}

function resolveEnvironmentLabel(env) {
  // APP_ENV comes first: it is the one signal an operator can set on any host, which
  // Cloud Run needs because it has no environment concept of its own.
  const requested = env.APP_ENV || env.VERCEL_ENV || env.NODE_ENV || ''
  return ENVIRONMENT_LABELS[requested] || null
}

/**
 * @param {Record<string, string|undefined>} [env]
 * @returns {{provider: string|null, environment: string|null, service: string|null, revision: string|null}}
 */
export function resolveDeploymentRuntime(env = process.env) {
  const vercelEnv = env.VERCEL_ENV || null
  const cloudRunService = env.K_SERVICE || null
  const nodeEnv = env.NODE_ENV || null

  let provider = null
  if (vercelEnv || env.VERCEL) provider = 'vercel'
  else if (cloudRunService) provider = 'cloud-run'
  else if (nodeEnv === 'development') provider = 'local'

  return {
    provider,
    environment: resolveEnvironmentLabel(env),
    service: cloudRunService || env.VERCEL_URL || null,
    revision: env.K_REVISION || env.VERCEL_DEPLOYMENT_ID || null,
  }
}
