export type Dsn = {
	key: string;
	projectId: string;
	/** Absolute URL of the project's ingest endpoint. */
	endpoint: string;
};

/**
 * Parses a Sentry-style DSN: `http://<key>@<host>[:port]/<projectId>`.
 * The key authenticates ingest; it is not a secret worth protecting, since it
 * ships inside the app.
 */
export function parseDsn(dsn: string): Dsn {
	let url: URL;
	try {
		url = new URL(dsn);
	} catch {
		throw new Error(`Invalid DSN: ${dsn}`);
	}
	const key = decodeURIComponent(url.username);
	const projectId = url.pathname.replace(/^\/+|\/+$/g, "");
	if (!key || !projectId || projectId.includes("/")) {
		throw new Error(
			`Invalid DSN, expected http://<key>@<host>/<project>: ${dsn}`,
		);
	}
	return {
		key,
		projectId,
		endpoint: `${url.protocol}//${url.host}/api/projects/${encodeURIComponent(projectId)}/events`,
	};
}
