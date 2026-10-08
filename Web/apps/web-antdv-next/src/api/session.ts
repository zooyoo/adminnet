export interface SessionTokens {
	accessToken: string;
	refreshToken: string;
}

export class SessionBoundary {
	get version() {
		return this.generation;
	}
	private readonly controllers = new Set<AbortController>();

	private generation = 0;

	invalidate() {
		this.generation += 1;
		for (const controller of this.controllers) controller.abort();
		this.controllers.clear();
	}

	release(controller: AbortController) {
		this.controllers.delete(controller);
	}

	track(controller: AbortController) {
		this.controllers.add(controller);
	}
}

export function isTokenExpired(token: string, now = Date.now()) {
	try {
		const payload = token.split('.')[1];
		if (!payload) return true;
		const normalized = payload.replaceAll('-', '+').replaceAll('_', '/');
		const { exp } = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')));
		return typeof exp !== 'number' || exp * 1000 <= now;
	} catch {
		return true;
	}
}

export const sessionBoundary = new SessionBoundary();
