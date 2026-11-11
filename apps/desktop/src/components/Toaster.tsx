import { Toaster as SonnerToaster } from "sonner";

/**
 * Themed toast container.
 *
 * Drop this once at the root of the app. It reads CSS custom-properties so
 * switching themes (light / dark / custom) "just works" — override the
 * variables in your stylesheet and every toast follows along.
 *
 * @see https://sonner.emilkowal.ski/styling
 */
export function Toaster() {
	return (
		<SonnerToaster
			position="bottom-right"
			/* Opt-in to richer per-type colors (success=green, error=red …) */
			richColors
			toastOptions={{
				classNames: {
					toast: "marky-toast",
					title: "marky-toast-title",
					description: "marky-toast-description",
					actionButton: "marky-toast-action",
					cancelButton: "marky-toast-cancel",
					closeButton: "marky-toast-close",
				},
			}}
		/>
	);
}
