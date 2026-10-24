import { describe, it, expect } from 'vitest';
import { containBox } from './images';
import { contentBounds } from './logoUpload';

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
