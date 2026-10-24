<script lang="ts">
	import Konva from 'konva';
	import { Stage, Layer, Rect, Text, Path, Group, Image, Line, Transformer } from 'svelte-konva';
	import { labelKind, type LabelDesign, type LabelElement } from '$lib/labels/types';
	import type { LabelBinding } from '$lib/labels/template';
	import { elementToShape, imageSource, qrLogoBox } from '$lib/labels/render';
	import { getLogoImage } from '$lib/labels/logo';
	import { loadImages } from '$lib/labels/images';
	import { vendorLogos } from '$lib/stores/vendorLogos.svelte';

	interface Props {
		design: LabelDesign;
		/** Spool data to resolve placeholders/QR/colors; omit for template preview. */
		binding?: LabelBinding;
		baseUrl?: string;
		/** Screen pixels per millimeter. */
		pxPerMm: number;
		/** Enable drag / select / resize. */
		interactive?: boolean;
		selectedId?: string | null;
		onselect?: (id: string | null) => void;
		/** Fired when an element's geometry changes via drag or resize. */
		onchange?: (el: LabelElement) => void;
	}
	let {
		design,
		binding,
		baseUrl = '',
		pxPerMm,
		interactive = false,
		selectedId = $bindable(null),
		onselect,
		onchange
	}: Props = $props();

	// svelte-konva exposes the underlying Konva node as a component export.
	let transformerRef = $state<{ node: Konva.Transformer } | undefined>();
	let stageRef = $state<{ node: Konva.Stage } | undefined>();
	let logoImage = $state<HTMLImageElement | null>(null);

	$effect(() => {
		getLogoImage()
			.then((img) => (logoImage = img))
			.catch(() => {});
	});

	// Image-element sources (vendor logos) for the bound data, decoded async; until
	// one arrives (or if it fails) the element draws its text fallback.
	$effect(() => {
		if (design.elements.some((el) => el.type === 'image')) void vendorLogos.ensure(binding?.vendor?.id);
	});
	const imageSrcs = $derived(
		design.elements.flatMap((el) => {
			const src = el.type === 'image' ? imageSource(el, binding) : null;
			return src ? [src] : [];
		})
	);
	let images = $state<Map<string, HTMLImageElement>>(new Map());
	$effect(() => {
		const srcs = imageSrcs;
		let cancelled = false;
		loadImages(srcs).then((map) => {
			if (!cancelled) images = map;
		});
		return () => {
			cancelled = true;
		};
	});

	const specs = $derived(
		design.elements.map((el) => ({
			el,
			spec: elementToShape(el, { binding, baseUrl, kind: labelKind(design), images })
		}))
	);
	const stageW = $derived(design.label.w * pxPerMm);
	const stageH = $derived(design.label.h * pxPerMm);
	const selectedEl = $derived(design.elements.find((e) => e.id === selectedId));
	const selectedType = $derived(selectedEl?.type);

	// Re-attach the transformer to the selected element's node every render. Each
	// top-level node carries its element id as a Konva name, so we look it up
	// fresh — surviving node re-creation (e.g. toggling wrap swaps Text↔Group).
	$effect(() => {
		void specs; // re-run when elements change
		const t = transformerRef?.node;
		const stage = stageRef?.node;
		if (!t || !stage) return;
		const node = selectedId ? stage.findOne('.' + selectedId) : undefined;
		t.nodes(node ? [node] : []);
		t.getLayer()?.batchDraw();
	});

	function select(id: string | null) {
		if (!interactive) return;
		selectedId = id;
		onselect?.(id);
	}

	function onStageClick(e: { target: Konva.Node }) {
		// A click on empty stage (target is the Stage itself) deselects.
		if (e.target === e.target.getStage()) select(null);
	}

	function commitDrag(el: LabelElement, node: Konva.Node) {
		onchange?.({ ...el, x: round(node.x()), y: round(node.y()) });
	}

	// Text lives in a group (with its optional background bar). It re-wraps live
	// while dragging a side handle: fold the group's horizontal scale into the
	// text (and background) width and reset it to 1 each frame (Konva's
	// editable-text pattern). Only scaleX is touched, so it never fights the
	// transformer. Non-wrapping text's group is clipped; the clip widens too.
	function textTransform(node: Konva.Node) {
		const g = node as Konva.Group;
		const t = g.findOne('Text') as Konva.Text | undefined;
		if (!t) return;
		const newW = Math.max(2, t.width() * g.scaleX());
		t.width(newW);
		(g.findOne('Rect') as Konva.Rect | undefined)?.width(newW);
		if (g.clipWidth()) g.clipWidth(newW);
		g.scaleX(1);
	}

	// On release, fold whatever scale remains into real mm dimensions.
	function commitTransform(el: LabelElement, node: Konva.Node) {
		const sx = node.scaleX();
		const sy = node.scaleY();
		node.scaleX(1);
		node.scaleY(1);
		const base = { ...el, x: round(node.x()), y: round(node.y()) };
		switch (el.type) {
			case 'qr':
				onchange?.({ ...base, size: round(el.size * sx) } as LabelElement);
				break;
			case 'text': {
				const t = (node as Konva.Group).findOne('Text') as Konva.Text | undefined;
				onchange?.({ ...base, w: round((t?.width() ?? el.w) * sx) } as LabelElement);
				break;
			}
			case 'image':
				onchange?.({ ...base, w: round(el.w * sx), h: round(el.h * sy) } as LabelElement);
				break;
			case 'separator':
				onchange?.({ ...base, length: round(el.length * (el.vertical ? sy : sx)) } as LabelElement);
				break;
			case 'swatch':
			case 'rect': {
				const r = node as Konva.Rect;
				onchange?.({ ...base, w: round(r.width() * sx), h: round(r.height() * sy) } as LabelElement);
				break;
			}
		}
	}

	function round(n: number): number {
		return Math.round(n * 100) / 100;
	}

	const ALL_ANCHORS = [
		'top-left',
		'top-center',
		'top-right',
		'middle-left',
		'middle-right',
		'bottom-left',
		'bottom-center',
		'bottom-right'
	];
	// Text resizes by width only (side handles) so it re-wraps; QR stays square;
	// boxes resize freely. Font size is set from the inspector.
	// A separator resizes along its length only; thickness is set from the inspector.
	const anchors = $derived(
		selectedType === 'text' || (selectedEl?.type === 'separator' && !selectedEl.vertical)
			? ['middle-left', 'middle-right']
			: selectedEl?.type === 'separator'
				? ['top-center', 'bottom-center']
				: selectedType === 'qr'
					? ['top-left', 'top-right', 'bottom-left', 'bottom-right']
					: ALL_ANCHORS
	);

	interface Box {
		x: number;
		y: number;
		width: number;
		height: number;
		rotation: number;
	}
	// Enforce a small minimum so a shape can't be collapsed to nothing. Only the
	// dimension being dragged is checked: a separator is thinner than the minimum
	// across its length by design, and must still be resizable along it.
	function boundBox(oldBox: Box, newBox: Box): Box {
		const min = 3 * pxPerMm;
		const tooSmall = (n: number, o: number) => Math.abs(n) < min && Math.abs(n - o) > 0.01;
		return tooSmall(newBox.width, oldBox.width) || tooSmall(newBox.height, oldBox.height) ? oldBox : newBox;
	}

	const TF_CONFIG = {
		rotateEnabled: false,
		anchorSize: 8,
		borderStroke: '#be682f',
		anchorStroke: '#be682f'
	};
</script>

<div class="label-canvas" style:width="{stageW}px" style:height="{stageH}px">
	<Stage bind:this={stageRef} width={stageW} height={stageH} onclick={onStageClick} ontap={onStageClick}>
		<Layer scaleX={pxPerMm} scaleY={pxPerMm}>
			{#each specs as { el, spec } (el.id)}
				{#if spec.kind === 'qr'}
					{@const box = qrLogoBox(spec.size)}
					<Group
						name={el.id}
						x={spec.x}
						y={spec.y}
						draggable={interactive}
						onclick={() => select(el.id)}
						ontap={() => select(el.id)}
						ondragend={(e) => commitDrag(el, e.target)}
						ontransformend={(e) => commitTransform(el, e.target)}
					>
						<Rect x={0} y={0} width={spec.size} height={spec.size} fill="#ffffff" />
						<Path data={spec.pathData} fill="#000000" />
						{#if spec.logo && logoImage}
							<Rect x={box.padXY} y={box.padXY} width={box.pad} height={box.pad} fill="#ffffff" />
							<Image image={logoImage} x={box.logoXY} y={box.logoXY} width={box.logo} height={box.logo} />
						{/if}
					</Group>
				{:else if spec.kind === 'text'}
					<Group
						name={el.id}
						x={spec.x}
						y={spec.y}
						draggable={interactive}
						onclick={() => select(el.id)}
						ontap={() => select(el.id)}
						ondragend={(e) => commitDrag(el, e.target)}
						ontransform={(e) => textTransform(e.target)}
						ontransformend={(e) => commitTransform(el, e.target)}
					>
						<!-- Always mounted (hidden when unused): svelte-konva appends a node that
						     mounts later on top, so toggling the background on would cover the text. -->
						<Rect
							x={0}
							y={0}
							width={Number(spec.config.width)}
							height={spec.bg?.height ?? 0}
							fill={spec.bg?.fill}
							visible={!!spec.bg}
						/>
						<Text {...spec.config} />
					</Group>
				{:else if spec.kind === 'separator'}
					<Group
						name={el.id}
						x={spec.x}
						y={spec.y}
						draggable={interactive}
						onclick={() => select(el.id)}
						ontap={() => select(el.id)}
						ondragend={(e) => commitDrag(el, e.target)}
						ontransformend={(e) => commitTransform(el, e.target)}
					>
						<!-- A hairline is hard to click; widen its hit area without changing the box. -->
						<Line {...spec.line} hitStrokeWidth={Math.max(2, Number(spec.line.strokeWidth))} />
					</Group>
				{:else if spec.kind === 'image'}
					<Group
						name={el.id}
						x={spec.x}
						y={spec.y}
						draggable={interactive}
						onclick={() => select(el.id)}
						ontap={() => select(el.id)}
						ondragend={(e) => commitDrag(el, e.target)}
						ontransformend={(e) => commitTransform(el, e.target)}
					>
						<!-- Transparent hit area so the whole box is draggable, not just the drawn pixels. -->
						<Rect x={0} y={0} width={spec.w} height={spec.h} fill="rgba(0,0,0,0)" />
						{#if spec.image}
							<Image
								image={spec.image.img}
								x={spec.image.x}
								y={spec.image.y}
								width={spec.image.width}
								height={spec.image.height}
							/>
						{:else if spec.text}
							<Text {...spec.text} />
						{/if}
					</Group>
				{:else if spec.kind === 'textclip'}
					<Group
						name={el.id}
						x={spec.x}
						y={spec.y}
						clipX={0}
						clipY={0}
						clipWidth={spec.width}
						clipHeight={spec.clipHeight}
						draggable={interactive}
						onclick={() => select(el.id)}
						ontap={() => select(el.id)}
						ondragend={(e) => commitDrag(el, e.target)}
						ontransform={(e) => textTransform(e.target)}
						ontransformend={(e) => commitTransform(el, e.target)}
					>
						<Rect
							x={0}
							y={0}
							width={spec.width}
							height={spec.bg?.height ?? 0}
							fill={spec.bg?.fill}
							visible={!!spec.bg}
						/>
						<Text {...spec.config} />
					</Group>
				{:else}
					<Rect
						{...spec.config}
						name={el.id}
						draggable={interactive}
						onclick={() => select(el.id)}
						ontap={() => select(el.id)}
						ondragend={(e) => commitDrag(el, e.target)}
						ontransformend={(e) => commitTransform(el, e.target)}
					/>
				{/if}
			{/each}
			{#if interactive}
				<Transformer
					bind:this={transformerRef}
					{...TF_CONFIG}
					enabledAnchors={anchors}
					keepRatio={selectedType === 'qr'}
					boundBoxFunc={boundBox}
				/>
			{/if}
		</Layer>
	</Stage>
</div>

<style>
	.label-canvas {
		background: #fff;
		border: 1px solid var(--border);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
	}
</style>
