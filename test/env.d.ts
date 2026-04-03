declare module 'cloudflare:workers' {
	/** Test-side `env` matches wrangler-generated bindings (none yet). */
	interface ProvidedEnv extends Env {
		readonly __providedEnv?: true;
	}
}
