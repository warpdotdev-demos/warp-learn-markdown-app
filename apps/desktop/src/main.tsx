import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { Toaster } from "./components/Toaster";
import { captureException, initErrorReporting } from "./errorReporting";
import { initThemePreference } from "./store/actions";
import "./components/toast.css";
import "./index.css";

initErrorReporting();
initThemePreference();

// Uncaught render errors reach window through React's default reportError, where
// the reporter's error hook sees them. Errors an error boundary catches don't,
// so report those here.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement, {
	onCaughtError: (error, info) => {
		console.error(error, info.componentStack);
		captureException(error, {
			handled: false,
			tags: { mechanism: "react-error-boundary" },
		});
	},
}).render(
	<React.StrictMode>
		<App />
		<Toaster />
	</React.StrictMode>,
);
