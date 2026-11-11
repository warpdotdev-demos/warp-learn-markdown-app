// node:sqlite prints an ExperimentalWarning on first load. It's expected here,
// so drop just that one and keep every other warning.
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
	const message = typeof warning === "string" ? warning : warning.message;
	if (message.includes("SQLite is an experimental feature")) return;
	(emitWarning as (...args: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;
