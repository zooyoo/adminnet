import { afterEach, describe, expect, it } from 'vitest';

import { preferencesManager } from './preferences';
import { usePreferences } from './use-preferences';

const original = structuredClone(JSON.parse(JSON.stringify(preferencesManager.getPreferences())));

afterEach(() => {
	preferencesManager.updatePreferences(original);
});

describe('mobile preferences entry', () => {
	it('keeps the automatic mobile entry in the user dropdown', () => {
		preferencesManager.updatePreferences({
			app: { enablePreferences: true, isMobile: true, preferencesButtonPosition: 'auto', layout: 'sidebar-nav' },
			header: { enable: true, hidden: false },
		});
		expect(usePreferences().preferencesButtonPosition.value).toEqual({
			fixed: false,
			header: false,
			userDropdown: true,
		});
	});

	it('retains an accessible floating entry when the header is unavailable', () => {
		preferencesManager.updatePreferences({
			app: { enablePreferences: true, isMobile: true, preferencesButtonPosition: 'auto' },
			header: { enable: false },
		});
		expect(usePreferences().preferencesButtonPosition.value.fixed).toBe(true);
	});

	it('leaves the desktop automatic entry in the header', () => {
		preferencesManager.updatePreferences({
			app: { enablePreferences: true, isMobile: false, preferencesButtonPosition: 'auto', layout: 'sidebar-nav' },
			header: { enable: true, hidden: false },
			sidebar: { hidden: false },
		});
		expect(usePreferences().preferencesButtonPosition.value).toEqual({
			fixed: false,
			header: true,
			userDropdown: false,
		});
	});

	it('respects an explicitly disabled entry', () => {
		preferencesManager.updatePreferences({
			app: { enablePreferences: false, isMobile: true },
		});
		expect(usePreferences().preferencesButtonPosition.value).toEqual({
			fixed: false,
			header: false,
			userDropdown: false,
		});
	});
});
