import { Button } from "@marky/ui";
import MingcuteCopy2Line from "~icons/mingcute/copy-2-line";
import { copyText } from "../lib/clipboard";
import { tildePath } from "../lib/tildePath";

function buildPrompt(filePath: string): string {
	return `Build a Marky HTML app at ${filePath} that...`;
}

export function HtmlAppEmptyState({ path }: { path: string }) {
	return (
		<div className="flex h-full items-center justify-center overflow-y-auto p-6">
			<div className="flex w-full max-w-lg flex-col gap-5">
				<div className="flex flex-col gap-1.5">
					<h2 className="text-xl font-semibold tracking-tight text-foreground">
						Build an HTML App
					</h2>
					<p className="text-sm text-muted-foreground">
						HTML Apps are live, interactive views of your notes: dashboards,
						trackers, indexes, anything you can describe. They can read and
						update your notes, and your agent builds one right into this file.
					</p>
				</div>

				<div className="flex flex-col gap-2">
					<span className="text-xs font-medium text-foreground">
						Prompt your agent
					</span>
					<CopyBlock
						value={buildPrompt(path)}
						display={buildPrompt(tildePath(path))}
						label="Prompt"
						ariaLabel="Copy prompt"
					/>
				</div>
			</div>
		</div>
	);
}

function CopyBlock({
	value,
	display,
	label,
	ariaLabel,
}: {
	value: string;
	display: string;
	label: string;
	ariaLabel: string;
}) {
	return (
		<div className="flex items-start gap-2 rounded-sm border border-border bg-muted/40 p-2">
			<code className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">
				{display}
			</code>
			<Button
				size="icon-sm"
				variant="ghost"
				aria-label={ariaLabel}
				onClick={() => void copyText(value, label)}
			>
				<MingcuteCopy2Line />
			</Button>
		</div>
	);
}
