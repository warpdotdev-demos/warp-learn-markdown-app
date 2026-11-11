(() => {
	const markyToken = window.__markyHtmlAppToken || window.name;
	let nextMarkyRequestId = 0;
	const pendingMarkyRequests = new Map();
	const postMarkyRequest = (id, method, params) => {
		parent.postMessage(
			{ type: "marky:request", id, method, params, token: markyToken },
			"*",
		);
	};
	const requestMarky = (method, params) =>
		new Promise((resolve, reject) => {
			const id = ++nextMarkyRequestId;
			const timeout = window.setTimeout(() => {
				pendingMarkyRequests.delete(id);
				reject(new Error("Marky request timed out"));
			}, 10000);
			pendingMarkyRequests.set(id, { resolve, reject, timeout });
			postMarkyRequest(id, method, params);
		});
	const safeRequestMarky = (method, params) =>
		requestMarky(method, params)
			.then((value) => ({ ok: true, value }))
			.catch((error) => ({
				ok: false,
				error: {
					message: error instanceof Error ? error.message : String(error),
				},
			}));

	window.addEventListener("message", (event) => {
		const data = event.data;
		if (!data || data.type !== "marky:response") return;
		const pending = pendingMarkyRequests.get(data.id);
		if (!pending) return;
		pendingMarkyRequests.delete(data.id);
		window.clearTimeout(pending.timeout);
		if (data.ok) pending.resolve(data.value);
		else if (data.error && typeof data.error.message === "string") {
			pending.reject(new Error(data.error.message));
		} else {
			pending.reject(new Error(data.error || "Marky request failed"));
		}
	});

	window.marky = {
		files: {
			list: (glob = "**/*") => requestMarky("files.list", { glob }),
			safeList: (glob = "**/*") => safeRequestMarky("files.list", { glob }),
			read: (path) => requestMarky("files.read", { path }),
			safeRead: (path) => safeRequestMarky("files.read", { path }),
			open: (path) => requestMarky("files.open", { path }),
			safeOpen: (path) => safeRequestMarky("files.open", { path }),
			create: (input) => requestMarky("files.create", { input }),
			safeCreate: (input) => safeRequestMarky("files.create", { input }),
			update: (path, patch) => requestMarky("files.update", { path, patch }),
			safeUpdate: (path, patch) =>
				safeRequestMarky("files.update", { path, patch }),
			remove: (path) => requestMarky("files.remove", { path }),
			safeRemove: (path) => safeRequestMarky("files.remove", { path }),
		},
		links: {
			open: (url) => requestMarky("links.open", { url }),
			safeOpen: (url) => safeRequestMarky("links.open", { url }),
		},
	};

	document.addEventListener("click", (event) => {
		if (event.defaultPrevented) return;
		const anchor =
			event.target instanceof Element ? event.target.closest("a[href]") : null;
		if (!anchor || !/^(https?:\/\/|mailto:)/i.test(anchor.href)) return;
		event.preventDefault();
		safeRequestMarky("links.open", { url: anchor.href });
	});

	const send = () => {
		const body = document.body;
		const bodyTop = body ? body.getBoundingClientRect().top : 0;
		const bodyPaddingBlockEnd = body
			? Number.parseFloat(getComputedStyle(body).paddingBlockEnd) || 0
			: 0;
		const height = body
			? Array.from(body.children).reduce((max, child) => {
					if (!(child instanceof HTMLElement)) return max;
					if (child.tagName === "SCRIPT" || child.tagName === "STYLE")
						return max;
					return Math.max(max, child.getBoundingClientRect().bottom - bodyTop);
				}, 0) + bodyPaddingBlockEnd
			: 0;
		parent.postMessage(
			{ type: "marky:html-app-height", height, token: markyToken },
			"*",
		);
	};
	const schedule = () => requestAnimationFrame(send);
	const resizeObserver = new ResizeObserver(schedule);
	let isObservingBody = false;
	const observeBody = () => {
		if (!document.body || isObservingBody) return;
		resizeObserver.observe(document.body);
		isObservingBody = true;
	};
	window.addEventListener("load", () => {
		observeBody();
		schedule();
	});
	resizeObserver.observe(document.documentElement);
	if (document.readyState === "loading") {
		document.addEventListener(
			"DOMContentLoaded",
			() => {
				observeBody();
				schedule();
			},
			{ once: true },
		);
	} else {
		observeBody();
	}
	schedule();
})();
