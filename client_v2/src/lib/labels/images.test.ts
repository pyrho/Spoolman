import { describe, it, expect } from 'vitest';
import { containBox } from './images';
import { contentBounds, fitLogo, LogoTooLargeError } from './logoUpload';
import { SETTING_MAX_LENGTH } from '$lib/stores/vendorLogos.svelte';

describe('containBox', () => {
	it('fits a wide image to the box width, centred vertically', () => {
		expect(containBox(200, 50, 20, 10, 'left')).toEqual({ x: 0, y: 2.5, width: 20, height: 5 });
	});
	it('fits a tall image to the box height and honours alignment', () => {
		expect(containBox(50, 100, 20, 10, 'left').x).toBe(0);
		expect(containBox(50, 100, 20, 10, 'center').x).toBe(7.5);
		expect(containBox(50, 100, 20, 10, 'right').x).toBe(15);
	});
	it('fills the box when the image has no intrinsic size', () => {
		expect(containBox(0, 0, 20, 10, 'center')).toEqual({ x: 0, y: 0, width: 20, height: 10 });
	});
});

describe('contentBounds', () => {
	function image(w: number, h: number, ink: [number, number][]) {
		const data = new Uint8ClampedArray(w * h * 4).fill(255); // opaque white
		for (const [x, y] of ink) data.set([0, 0, 0, 255], (y * w + x) * 4);
		return data;
	}
	it('crops white margins around the ink', () => {
		expect(
			contentBounds(
				image(10, 6, [
					[2, 1],
					[7, 4]
				]),
				10,
				6
			)
		).toEqual({ x: 2, y: 1, w: 6, h: 4 });
	});
	it('treats transparent pixels as margin', () => {
		const data = new Uint8ClampedArray(4 * 4 * 4); // fully transparent black
		data.set([0, 0, 0, 255], (1 * 4 + 1) * 4);
		expect(contentBounds(data, 4, 4)).toEqual({ x: 1, y: 1, w: 1, h: 1 });
	});
	it('returns null for a blank image', () => {
		expect(contentBounds(image(3, 3, []), 3, 3)).toBeNull();
	});
});

describe('fitLogo', () => {
	// A fake encoder whose output size is proportional to the pixel count.
	const encoder =
		(bytesPerPx: Record<string, number>, calls: string[] = []) =>
		(side: number, type: string) => {
			calls.push(`${side}:${type}`);
			return `data:${type};base64,` + 'A'.repeat(Math.round(side * side * (bytesPerPx[type] ?? 0)));
		};

	it('keeps the largest PNG that fits', () => {
		const url = fitLogo(800, encoder({ 'image/png': 0.05, 'image/webp': 0.01 }));
		expect(url.startsWith('data:image/png')).toBe(true);
		expect(url.length + 2).toBeLessThanOrEqual(SETTING_MAX_LENGTH);
	});

	it('falls back to WebP, then to smaller sizes, until it fits', () => {
		const calls: string[] = [];
		const url = fitLogo(800, encoder({ 'image/png': 0.5, 'image/webp': 0.2 }, calls));
		expect(url.startsWith('data:image/webp')).toBe(true);
		expect(url.length + 2).toBeLessThanOrEqual(SETTING_MAX_LENGTH);
		expect(calls.slice(0, 3)).toEqual(['800:image/png', '800:image/webp', '640:image/png']);
	});

	it('skips a format the browser silently encodes as PNG instead', () => {
		// Safari ignores image/webp in toDataURL and returns a PNG.
		const pngOnly = (side: number) => 'data:image/png;base64,' + 'A'.repeat(side * side * 0.5);
		expect(fitLogo(800, pngOnly).length + 2).toBeLessThanOrEqual(SETTING_MAX_LENGTH);
	});

	it('never upscales a small logo', () => {
		const calls: string[] = [];
		fitLogo(300, encoder({ 'image/png': 0.01 }, calls));
		expect(calls).toEqual(['300:image/png']);
	});

	it('gives up when nothing fits', () => {
		expect(() => fitLogo(800, encoder({ 'image/png': 50, 'image/webp': 50 }))).toThrow(LogoTooLargeError);
	});
});
