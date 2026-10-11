import type { TestProject } from 'vitest/node';
import { findBinDir, startCluster, type TestCluster } from './cluster.js';

declare module 'vitest' {
	export interface ProvidedContext {
		/** The integration test cluster, or null when PostgreSQL isn't installed. */
		pg: TestCluster | null;
	}
}

export default async function setup(project: TestProject) {
	const typesOnly =
		project.config.typecheck.enabled && project.config.typecheck.only;
	const binDir =
		process.env['QUARRY_SKIP_PG'] || typesOnly ? undefined : findBinDir();
	if (binDir === undefined) {
		project.provide('pg', null);
		return;
	}
	const cluster = await startCluster(binDir);
	project.provide('pg', cluster.info);
	return () => cluster.stop();
}
