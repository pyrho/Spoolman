// Loads the images that label `image` elements point at (a vendor logo, usually
// a data URL stored in a vendor extra field). Cached per source so the editor
// canvas and every print job reuse one decode. Remote URLs are requested with
// CORS: a server that doesn't allow it fails to load (→ the element's text
// fallback) instead of tainting the canvas and breaking print/export.

const cache = new Map<string, Promise<HTMLImageElement | null>>();

/** Resolve to the decoded image, or null when it can't be loaded. Never rejects. */
export function loadImage(src: string): Promise<HTMLImageElement | null> {
	let p = cache.get(src);
	if (!p) {
		p = new Promise((resolve) => {
			const img = new Image();
			if (!src.startsWith('data:')) img.crossOrigin = 'anonymous';
			img.onload = () => resolve(img);
			img.onerror = () => resolve(null);
			img.src = src;
		});
		cache.set(src, p);
	}
	return p;
}

/** Load every distinct source; returns a src → image map (failed loads omitted). */
export async function loadImages(srcs: Iterable<string>): Promise<Map<string, HTMLImageElement>> {
	const unique = [...new Set(srcs)];
	const imgs = await Promise.all(unique.map(loadImage));
	const out = new Map<string, HTMLImageElement>();
	unique.forEach((src, i) => {
		const img = imgs[i];
		if (img) out.set(src, img);
	});
	return out;
}

/** Where to draw an image of natural size iw×ih "contained" in a w×h box (mm). */
export function containBox(
	iw: number,
	ih: number,
	w: number,
	h: number,
	align: 'left' | 'center' | 'right'
): { x: number; y: number; width: number; height: number } {
	if (!(iw > 0 && ih > 0)) return { x: 0, y: 0, width: w, height: h };
	const scale = Math.min(w / iw, h / ih);
	const width = iw * scale;
	const height = ih * scale;
	const x = align === 'left' ? 0 : align === 'right' ? w - width : (w - width) / 2;
	return { x, y: (h - height) / 2, width, height };
}
