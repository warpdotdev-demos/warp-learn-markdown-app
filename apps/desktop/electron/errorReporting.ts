import path from "node:path";
import {
	forwardRendererEvents,
	initNodeReporter,
	type NodeReporter,
} from "@marky/error-reporter/node";
import { app, ipcMain } from "electron";

/** Reporting is opt-in: it only runs when MARKY_ERROR_DSN points at a monitor. */
export function errorReportingDsn(): string | null {
	return process.env.MARKY_ERROR_DSN?.trim() || null;
}

/**
 * Reports main-process crashes and relays renderer reports to the error
 * monitor. Call after the userData path is final, since undelivered events are
 * queued there.
 */
export function setupErrorReporting(): NodeReporter | null {
	const dsn = errorReportingDsn();
	if (!dsn) return null;
	// Main-process stacks then point at electron/*.ts instead of the bundle.
	process.setSourceMapsEnabled(true);

	let warned = false;
	let reporter: NodeReporter;
	try {
		reporter = initNodeReporter({
			dsn,
			// MARKY_RELEASE lets a demo pretend to be a newer build.
			release: process.env.MARKY_RELEASE?.trim() || `marky@${app.getVersion()}`,
			environment: app.isPackaged ? "production" : "development",
			platform: "electron-main",
			queuePath: path.join(app.getPath("userData"), "error-reports.json"),
			// Electron keeps running after a main-process exception; so do we.
			exitOnUncaught: false,
			onTransportError: (error) => {
				if (warned) return;
				warned = true;
				console.warn(
					"Error monitor unreachable; reports are queued until it is.",
					error instanceof Error ? error.message : error,
				);
			},
		});
	} catch (error) {
		console.warn("Error reporting disabled:", error);
		return null;
	}

	reporter.client.setTag("os", process.platform);
	forwardRendererEvents(ipcMain, reporter.client);
	app.on("render-process-gone", (_event, _contents, details) => {
		if (details.reason === "clean-exit") return;
		reporter.client.captureMessage(
			`Renderer process gone: ${details.reason}`,
			"fatal",
			{
				handled: false,
				tags: {
					mechanism: "render-process-gone",
					exitCode: String(details.exitCode),
				},
			},
		);
	});
	app.on("will-quit", () => reporter.close());
	return reporter;
}
