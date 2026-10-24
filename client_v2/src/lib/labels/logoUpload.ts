// Turns an uploaded logo file into the data URL stored for a vendor: decoded,
// cropped to its visible content (logos usually ship with generous margins,
// which would shrink the printed mark), and scaled down to a size that's still
// sharp on a label but small enough to keep the settings payload light.

/** Longest side of the stored image, in px. ~70 mm wide at 300 dpi. */
const MAX_SIDE = 800;
/** Pixels at least this close to white (or this transparent) count as margin. */
const WHITE = 245;
const TRANSPARENT = 16;

function decode(file: File): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const url = URL.createObjectURL(file);
		const img = new Image();
		img.onload = () => {
			URL.revokeObjectURL(url);
			resolve(img);
		};
		img.onerror = (e) => {
			URL.revokeObjectURL(url);
			reject(e);
		};
		img.src = url;
	});
}

/** Bounding box of the non-margin pixels, or null for a blank image. */
export function contentBounds(
	data: Uint8ClampedArray,
	width: number,
	height: number
): { x: number; y: number; w: number; h: number } | null {
	let minX = width;
	let minY = height;
	let maxX = -1;
	let maxY = -1;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			const blank =
				data[i + 3] < TRANSPARENT || (data[i] >= WHITE && data[i + 1] >= WHITE && data[i + 2] >= WHITE);
			if (blank) continue;
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
		}
	}
	return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export async function prepareLogo(file: File): Promise<string> {
	const img = await decode(file);
	// An SVG without intrinsic dimensions reports 0×0 (or a tiny default); draw it
	// at full resolution instead.
	let iw = img.naturalWidth;
	let ih = img.naturalHeight;
	if (!(iw > 0 && ih > 0)) {
		iw = MAX_SIDE;
		ih = MAX_SIDE / 2;
	}
	// Rasterize large first (vector sources stay crisp), then crop and downscale.
	const up = Math.max(1, Math.min(4, MAX_SIDE / Math.max(iw, ih)));
	const src = document.createElement('canvas');
	src.width = Math.round(iw * up);
	src.height = Math.round(ih * up);
	const sctx = src.getContext('2d')!;
	sctx.drawImage(img, 0, 0, src.width, src.height);

	const bounds = contentBounds(
		sctx.getImageData(0, 0, src.width, src.height).data,
		src.width,
		src.height
	) ?? {
		x: 0,
		y: 0,
		w: src.width,
		h: src.height
	};
	const scale = Math.min(1, MAX_SIDE / Math.max(bounds.w, bounds.h));
	const out = document.createElement('canvas');
	out.width = Math.max(1, Math.round(bounds.w * scale));
	out.height = Math.max(1, Math.round(bounds.h * scale));
	out.getContext('2d')!.drawImage(src, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, out.width, out.height);
	return out.toDataURL('image/png');
}
