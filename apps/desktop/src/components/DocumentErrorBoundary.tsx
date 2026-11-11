import { Button } from "@marky/ui";
import { Component, type ReactNode } from "react";

type Props = {
	children: ReactNode;
	/** Offered when the file has a source view, which skips the rich editor. */
	onOpenSource?: () => void;
};

type State = { error: Error | null };

/**
 * Keeps a crash in one document from blanking the whole window, so tabs,
 * the sidebar, and other notes stay usable. Reporting happens in the React
 * root's onCaughtError. Key it by document so switching notes resets it.
 */
export class DocumentErrorBoundary extends Component<Props, State> {
	state: State = { error: null };

	static getDerivedStateFromError(error: unknown): State {
		return { error: error instanceof Error ? error : new Error(String(error)) };
	}

	render() {
		const { error } = this.state;
		if (!error) return this.props.children;
		return (
			<div className="flex h-full items-center justify-center p-6">
				<div className="flex max-w-md flex-col gap-3 text-sm">
					<p className="m-0 font-medium">This note couldn't be displayed.</p>
					<p className="m-0 font-mono text-xs text-muted-foreground">
						{error.message}
					</p>
					<div className="flex gap-2">
						{this.props.onOpenSource && (
							<Button size="sm" onClick={this.props.onOpenSource}>
								Open as source
							</Button>
						)}
						<Button
							size="sm"
							variant="outline"
							onClick={() => this.setState({ error: null })}
						>
							Try again
						</Button>
					</div>
				</div>
			</div>
		);
	}
}
