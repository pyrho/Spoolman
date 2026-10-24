import Konva from 'konva';
import type { ImageElement, LabelElement, LabelKind } from './types';
import { resolveTemplate, type LabelBinding } from './template';
import { qrContent, qrPathData, qrTemplate } from './qr';
import { containBox } from './images';

// Turns a design element into a Konva shape spec (in mm units — the Konva layer
// is scaled by px-per-mm). Text/swatch/rect map to a single node; QR maps to a
// small group (white background + module path + optional centre logo). The
// declarative editor and the imperative print export share these specs so their
// geometry stays identical.

export interface RenderContext {
	/** Bound spool/filament data; when absent the design renders in "template" preview. */
	binding?: LabelBinding;
	baseUrl: string;
	/** Whether the design labels spools or filaments. Defaults to `spool`. */
	kind?: LabelKind;
	/** Decoded images keyed by source (see ./images); a missing one draws the fallback. */
	images?: Map<string, HTMLImageElement>;
}

/** Background bar behind a text block: the block's width × its rendered height. */
export interface TextBg {
	fill: string;
	height: number;
}

export type ShapeSpec =
	| { kind: 'rect'; config: Record<string, unknown> }
	| { kind: 'text'; x: number; y: number; bg?: TextBg; config: Record<string, unknown> }
	| {
			kind: 'textclip';
			x: number;
			y: number;
			width: number;
			clipHeight: number;
			bg?: TextBg;
			config: Record<string, unknown>;
	  }
	| { kind: 'qr'; x: number; y: number; size: number; pathData: string; logo: boolean }
	| {
			kind: 'image';
			x: number;
			y: number;
			w: number;
			h: number;
			/** The image and where it sits inside the box, when there is one... */
			image?: { img: HTMLImageElement; x: number; y: number; width: number; height: number };
			/** ...otherwise the fallback text config (box-relative). */
			text?: Record<string, unknown>;
	  };

const PLACEHOLDER_SWATCH = '#9aa0a6';

// Ring thickness (mm) for the swatch's definition border. The printed/canvas
// swatch is intentionally flat (no gloss) — the glossy sheen lives only in the
// on-screen Swatch.svelte chip — but the ring keeps light colours legible
// against a white label.
const SWATCH_RING = 0.12;

/** Builds the flat colour rect config (fill + definition ring) for a swatch. */
function swatchConfig(x: number, y: number, width: number, height: number, radius: number, colors: string[]) {
	const config: Record<string, unknown> = {
		x,
		y,
		width,
		height,
		cornerRadius: radius,
		stroke: 'rgba(0,0,0,0.35)',
		strokeWidth: SWATCH_RING
	};
	if (colors.length === 0) {
		config.fill = PLACEHOLDER_SWATCH;
	} else if (colors.length === 1) {
		config.fill = colors[0];
	} else {
		// Even gradient stops across the width for multi-color filaments.
		const stops: (number | string)[] = [];
		colors.forEach((hex, i) => {
			stops.push(colors.length === 1 ? 0 : i / (colors.length - 1), hex);
		});
		config.fillLinearGradientStartPoint = { x: 0, y: 0 };
		config.fillLinearGradientEndPoint = { x: width, y: 0 };
		config.fillLinearGradientColorStops = stops;
	}
	return config;
}

/** Geometry (in mm, relative to the QR's top-left) for a centred logo. */
export function qrLogoBox(size: number) {
	// Square (not rounded) so the white backing fully covers the QR modules
	// behind it right into the corners — a rounded corner would carve away
	// white area there and let the black modules peek through.
	const pad = size * 0.285;
	const logo = size * 0.25;
	return {
		pad,
		padXY: (size - pad) / 2,
		logo,
		logoXY: (size - logo) / 2
	};
}

/** The image source an element resolves to for a binding, or null for none. */
export function imageSource(el: ImageElement, binding: LabelBinding | undefined): string | null {
	if (!binding) return null;
	const src = resolveTemplate(el.source, binding).trim();
	return src === '' || src === '?' ? null : src;
}

const FALLBACK_LINE_HEIGHT = 1;

/**
 * Bold one-line text that fills the box height, shrunk to fit its width — the
 * stand-in for a vendor without a logo (the "PolyTerra" style header).
 */
function fallbackTextConfig(el: ImageElement, text: string): Record<string, unknown> {
	const base = {
		text,
		fontStyle: 'bold',
		fontFamily: 'sans-serif',
		lineHeight: FALLBACK_LINE_HEIGHT,
		wrap: 'none',
		align: el.align,
		verticalAlign: 'middle',
		fill: el.color
	};
	let fontSize = el.h * 0.85;
	try {
		const measured = new Konva.Text({ ...base, fontSize }).measureSize(text).width;
		if (measured > el.w) fontSize *= el.w / measured;
	} catch {
		// No canvas to measure with (e.g. a test environment): keep the height-based size.
	}
	return { ...base, x: 0, y: 0, width: el.w, height: el.h, fontSize };
}

/** Rendered height (mm) of a wrapping text config, for sizing its background. */
function measuredHeight(config: Record<string, unknown>): number {
	try {
		return new Konva.Text(config).height();
	} catch {
		const fontSize = Number(config.fontSize) || 0;
		const pad = Number(config.padding) || 0;
		const lines = String(config.text ?? '').split('\n').length;
		return fontSize * 1.15 * lines + pad * 2;
	}
}

export function elementToShape(el: LabelElement, ctx: RenderContext): ShapeSpec {
	switch (el.type) {
		case 'qr': {
			const qrCtx = { baseUrl: ctx.baseUrl, kind: ctx.kind };
			// The QR's subject is the spool (spool labels) or filament (filament labels).
			const subjectId = ctx.kind === 'filament' ? ctx.binding?.filament?.id : ctx.binding?.spool?.id;
			// With no bound subject (editor canvas), preview the template with id 0 so
			// the QR's module density matches what will actually print for this
			// encoding — a long URL/custom target is denser than the compact scheme.
			const content =
				subjectId !== undefined
					? qrContent(el, subjectId, qrCtx, ctx.binding)
					: qrTemplate(el, qrCtx).replace('{id}', '0');
			return {
				kind: 'qr',
				x: el.x,
				y: el.y,
				size: el.size,
				pathData: qrPathData(content, el.ec, el.size),
				logo: el.logo
			};
		}
		case 'text': {
			const text = ctx.binding
				? resolveTemplate(el.template, ctx.binding)
				: el.template.replace(/\*\*(.*?)\*\*/gs, '$1');
			// Padding only applies with a background; without one it would just shift
			// the text from where older designs placed it.
			const pad = el.bg ? Math.max(0, el.pad ?? 0) : 0;
			const common = {
				text,
				fontSize: el.fontSize,
				fontStyle: el.bold ? 'bold' : 'normal',
				fontFamily: 'sans-serif',
				align: el.align,
				fill: el.color,
				lineHeight: 1.15,
				padding: pad
			};
			// Default (undefined) wraps, for backward compatibility with older designs.
			// Text configs are relative to the element origin (x/y) — the canvas and
			// print code place them, together with any background, in a group there.
			if (el.wrap !== false) {
				const config = { x: 0, y: 0, width: el.w, wrap: 'word', ...common };
				const bg = el.bg ? { fill: el.bg, height: measuredHeight(config) } : undefined;
				return { kind: 'text', x: el.x, y: el.y, bg, config };
			}
			// No wrap: keep each line on one line and clip horizontal overflow to `w`.
			const lines = Math.max(1, text.split('\n').length);
			const clipHeight = el.fontSize * 1.15 * lines + el.fontSize * 0.3 + pad * 2;
			// Pin the text height so the transformer box matches the clip (Konva
			// otherwise reports the wrapped height even with wrap disabled).
			return {
				kind: 'textclip',
				x: el.x,
				y: el.y,
				width: el.w,
				clipHeight,
				bg: el.bg ? { fill: el.bg, height: clipHeight } : undefined,
				config: { x: 0, y: 0, width: el.w, height: clipHeight, wrap: 'none', ...common }
			};
		}
		case 'image': {
			const src = imageSource(el, ctx.binding);
			const img = src ? ctx.images?.get(src) : undefined;
			const shape = { kind: 'image' as const, x: el.x, y: el.y, w: el.w, h: el.h };
			if (img) {
				const box = containBox(
					img.naturalWidth || img.width,
					img.naturalHeight || img.height,
					el.w,
					el.h,
					el.align
				);
				return { ...shape, image: { img, ...box } };
			}
			const text = ctx.binding ? resolveTemplate(el.fallback, ctx.binding) : el.fallback;
			return { ...shape, text: fallbackTextConfig(el, text.replace(/\*\*(.*?)\*\*/gs, '$1')) };
		}
		case 'swatch': {
			const colors = ctx.binding?.filament?.colors ?? [];
			return { kind: 'rect', config: swatchConfig(el.x, el.y, el.w, el.h, el.radius, colors) };
		}
		case 'rect': {
			return {
				kind: 'rect',
				config: {
					x: el.x,
					y: el.y,
					width: el.w,
					height: el.h,
					cornerRadius: el.radius,
					fill: el.fill || undefined,
					stroke: el.stroke || undefined,
					strokeWidth: el.strokeWidth
				}
			};
		}
	}
}
