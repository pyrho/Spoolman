import { getJson } from '$lib/api/http';
import { setSetting, parseSetting, type SettingResponse } from '$lib/api/settings';

// Vendor logos for labels, stored as one `vendor_logos` server setting mapping a
// vendor id to an image data URL (registered in spoolman/settings.py). Not a
// vendor extra field: every spool response embeds its vendor, so a logo there
// would ride along in every spool listing.

class VendorLogos {
	logos = $state<Record<string, string>>({});
	loaded = $state(false);
	private loading: Promise<void> | null = null;

	/** Load once (idempotent); resolves when the logos are available. */
	ensure(): Promise<void> {
		this.loading ??= this.fetch();
		return this.loading;
	}

	private async fetch(): Promise<void> {
		try {
			const s = await getJson<SettingResponse>('/setting/vendor_logos');
			this.logos = parseSetting<Record<string, string>>(s, {});
		} catch (e) {
			console.error('Failed to load vendor logos', e);
		} finally {
			this.loaded = true;
		}
	}

	get(vendorId: string | undefined): string | undefined {
		return vendorId === undefined ? undefined : this.logos[vendorId];
	}

	/** Set (or with `null`, remove) a vendor's logo and persist. */
	async set(vendorId: string, dataUrl: string | null): Promise<void> {
		// Re-read first so a logo saved from another tab since we loaded isn't dropped.
		const s = await getJson<SettingResponse>('/setting/vendor_logos');
		const next = { ...parseSetting<Record<string, string>>(s, {}) };
		if (dataUrl === null) delete next[vendorId];
		else next[vendorId] = dataUrl;
		await setSetting('vendor_logos', next);
		this.logos = next;
		this.loaded = true;
	}
}

export const vendorLogos = new VendorLogos();
