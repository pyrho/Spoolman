<script lang="ts">
	import Button from '../Button.svelte';
	import { vendorLogos } from '$lib/stores/vendorLogos.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { prepareLogo } from '$lib/labels/logoUpload';
	import * as m from '$lib/paraglide/messages';

	// The vendor's label logo: a preview plus upload / remove. Printed by the
	// "Manufacturer logo" label element (see $lib/labels/types ImageElement).

	let { vendorId }: { vendorId: string } = $props();

	$effect(() => {
		void vendorLogos.ensure();
	});
	let logo = $derived(vendorLogos.get(vendorId));
	let busy = $state(false);
	let input = $state<HTMLInputElement | undefined>();

	async function upload(file: File) {
		busy = true;
		try {
			const dataUrl = await prepareLogo(file);
			await vendorLogos.set(vendorId, dataUrl);
		} catch (e) {
			console.error('Failed to save vendor logo', e);
			toasts.error(m['vendor.logo.failed']());
		} finally {
			busy = false;
		}
	}

	async function remove() {
		busy = true;
		try {
			await vendorLogos.set(vendorId, null);
		} catch (e) {
			console.error('Failed to remove vendor logo', e);
			toasts.error(m['vendor.logo.failed']());
		} finally {
			busy = false;
		}
	}
</script>

<div class="logo-field">
	{#if logo}
		<img class="preview" src={logo} alt={m['vendor.fields.logo']()} />
	{/if}
	<div class="buttons">
		<Button variant="outline" disabled={busy} onclick={() => input?.click()}
			>{logo ? m['vendor.logo.replace']() : m['vendor.logo.upload']()}</Button
		>
		{#if logo}
			<Button variant="ghost" disabled={busy} onclick={remove}>{m['vendor.logo.remove']()}</Button>
		{/if}
	</div>
	<input
		bind:this={input}
		type="file"
		accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
		hidden
		onchange={(e) => {
			const file = e.currentTarget.files?.[0];
			e.currentTarget.value = '';
			if (file) void upload(file);
		}}
	/>
</div>

<style>
	.logo-field {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
	}
	.preview {
		max-width: 200px;
		max-height: 48px;
		object-fit: contain;
		/* Labels are printed on white; preview the logo the same way in dark mode. */
		background: #fff;
		padding: 4px 6px;
		border-radius: 4px;
	}
	.buttons {
		display: flex;
		gap: 6px;
	}
</style>
