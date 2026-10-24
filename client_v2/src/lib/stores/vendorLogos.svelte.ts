import { getJson } from '$lib/api/http';
import { setSetting, parseSetting, type SettingResponse } from '$lib/api/settings';

// Vendor logos for labels: an image data URL per vendor, each in its own
// `vendor_logo.<id>` server setting (see spoolman/settings.py). One setting per
// vendor because a setting holds at most 64 KiB, which a handful of logos
// sharing one value quickly exceeded. Not a vendor extra field: every spool
// response embeds its vendor, so a logo there would ride along in every spool
// listing. Loaded lazily, one vendor at a time.

/** Longest JSON value a setting accepts (SETTING_MAX_LENGTH in spoolman/database/setting.py). */
export const SETTING_MAX_LENGTH = 2 ** 16 - 1;

/** Logos saved before the per-vendor settings, all in one object. */
const LEGACY_KEY = 'vendor_logos';

function settingKey(vendorId: string): string {
	return `vendor_logo.${vendorId}`;
}

class VendorLogos {
	/** Loaded logos by vendor id; `null` = loaded, no logo. Absent = not loaded yet. */
	logos = $state<Record<string, string | null>>({});
	private loading = new Map<string, Promise<void>>();
	private migration: Promise<void> | null = null;

	/**
	 * Move logos from the old single `vendor_logos` setting into per-vendor
	 * settings, once. Each is written before the old setting is cleared, so an
	 * interrupted run is simply repeated next time.
	 */
	private migrate(): Promise<void> {
		this.migration ??= (async () => {
			try {
				const legacy = parseSetting<Record<string, string>>(
					await getJson<SettingResponse>(`/setting/${LEGACY_KEY}`),
					{}
				);
				const entries = Object.entries(legacy).filter(([, url]) => typeof url === 'string' && url !== '');
				if (entries.length === 0) return;
				for (const [vendorId, url] of entries) {
					// Don't clobber a logo uploaded under the new scheme since.
					const current = parseSetting<string>(
						await getJson<SettingResponse>(`/setting/${settingKey(vendorId)}`),
						''
					);
					if (!current) await setSetting(settingKey(vendorId), url);
				}
				await setSetting(LEGACY_KEY, null);
			} catch (e) {
				console.error('Failed to migrate vendor logos', e);
			}
		})();
		return this.migration;
	}

	/** Load a vendor's logo once (idempotent); resolves when it's available. */
	ensure(vendorId: string | undefined): Promise<void> {
		if (vendorId === undefined) return Promise.resolve();
		let p = this.loading.get(vendorId);
		if (!p) {
			p = this.fetch(vendorId);
			this.loading.set(vendorId, p);
		}
		return p;
	}

	/** Load several vendors' logos. */
	ensureAll(vendorIds: Iterable<string | undefined>): Promise<void> {
		return Promise.all([...new Set(vendorIds)].map((id) => this.ensure(id))).then(() => undefined);
	}

	private async fetch(vendorId: string): Promise<void> {
		await this.migrate();
		try {
			const s = await getJson<SettingResponse>(`/setting/${settingKey(vendorId)}`);
			const url = parseSetting<string>(s, '');
			this.logos = { ...this.logos, [vendorId]: url || null };
		} catch (e) {
			console.error(`Failed to load the logo of vendor ${vendorId}`, e);
			// Forget the attempt so a later render can retry.
			this.loading.delete(vendorId);
		}
	}

	/** The vendor's logo, if loaded. Reactive: reading it re-runs once it arrives. */
	get(vendorId: string | undefined): string | undefined {
		return vendorId === undefined ? undefined : (this.logos[vendorId] ?? undefined);
	}

	/** Set (or with `null`, remove) a vendor's logo and persist. */
	async set(vendorId: string, dataUrl: string | null): Promise<void> {
		await this.migrate();
		// `null` unsets the setting server-side.
		await setSetting(settingKey(vendorId), dataUrl);
		this.logos = { ...this.logos, [vendorId]: dataUrl };
		this.loading.set(vendorId, Promise.resolve());
	}
}

export const vendorLogos = new VendorLogos();
