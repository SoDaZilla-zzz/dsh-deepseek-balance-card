// dsh-liquid-glass-balance-card — browser half.
//
// A draggable liquid-glass floating card pinned to the top-right corner of the
// DSH web GUI (registered into the frame-wide `shell.overlay` slot). It polls
// the host route `/api/liquid-glass-balance-card/balance`, supports a manual API
// key in its settings popover, and remembers its dragged position in
// localStorage.
//
// Usage statistics are two-tier: "本地" aggregates DSH session logs locally
// (`/stats`), while "总计（线上）" reads DeepSeek's platform dashboard usage
// through `/online-stats` (requires the optional platform `userToken`
// credential configured in the card settings or the plugin config card).
//
// The bundle is a CJS closure-factory consumed by DSH's client module loader.
window.__ModuleLoader__.load({
	id: "dsh-liquid-glass-balance-card",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let jsxRuntime = require("react/jsx-runtime");
		const React = react;
		const { useState, useEffect, useLayoutEffect, useCallback, useRef } = react;
		const { jsx, jsxs, Fragment } = jsxRuntime;

		// ---- constants -------------------------------------------------
		const SETTINGS_PATH = "/api/liquid-glass-balance-card/settings";
		const BALANCE_PATH = "/api/liquid-glass-balance-card/balance";
		const STATS_PATH = "/api/liquid-glass-balance-card/stats";
		const ONLINE_STATS_PATH = "/api/liquid-glass-balance-card/online-stats";
		const RANGE_LABELS = { today: "今天", yesterday: "昨天", "7d": "近7天", "30d": "近30天", all: "全部" };
		// Chart metric tabs. Besides the total, Tokens can be split into the
		// input / cache-hit / output buckets (both 本地 and 总计（线上）daily
		// payloads carry these fields).
		const CHART_METRICS = [
			{ key: "cost", label: "消费金额" },
			{ key: "tokens", label: "Tokens" },
			{ key: "input", label: "输入" },
			{ key: "cache", label: "缓存" },
			{ key: "output", label: "输出" }
		];
		const POSITION_KEY = "dsh-liquid-glass-balance-card-pos";
		const GLASS_KEY = "dsh-liquid-glass-balance-card-glass";
		const COLLAPSED_KEY = "dsh-liquid-glass-balance-card-collapsed";
		const SHOW_TOTAL_KEY = "dsh-liquid-glass-balance-card-show-total";
		const DEFAULT_GLASS = {
			alpha: 14,
			blur: 4,
			saturate: 140,
			highlight: 0.35,
			shine: 0.14,
			enable3d: true,
			thickness: 12,
			angle: 12,
			colorEnabled: false,
			color: "#4f8cff",
			colorStrength: 30,
			cardWidth: 264,
			cardHeight: 0,
			currency: "CNY"
		};
		const CARD_WIDTH = 264;
		const CARD_HEIGHT = 180;

		// ---- small helpers ---------------------------------------------
		function currencySymbol(code) {
			switch (code) {
				case "CNY": return "¥";
				case "USD": return "$";
				case "EUR": return "€";
				case "JPY": return "¥";
				case "HKD": return "HK$";
				default: return code ? `${code} ` : "";
			}
		}

		function formatBalance(value, currency) {
			const symbol = currencySymbol(currency);
			return `${symbol}${String(value)}`;
		}

		function formatCost(value, currency) {
			const symbol = currencySymbol(currency);
			if (!Number.isFinite(value) || value <= 0) return `${symbol}0`;
			if (value >= 100) return `${symbol}${value.toFixed(0)}`;
			if (value >= 1) return `${symbol}${value.toFixed(2)}`;
			if (value >= 0.01) return `${symbol}${value.toFixed(3)}`;
			return `${symbol}${value.toPrecision(2)}`;
		}

		function formatTokens(value) {
			const n = Number.isFinite(value) ? Math.round(value) : 0;
			return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
		}

		function formatTime(date) {
			const hh = String(date.getHours()).padStart(2, "0");
			const mm = String(date.getMinutes()).padStart(2, "0");
			const ss = String(date.getSeconds()).padStart(2, "0");
			return `${hh}:${mm}:${ss}`;
		}

		function clamp(value, min, max) {
			return Math.min(max, Math.max(min, value));
		}

		function loadPosition() {
			try {
				const raw = localStorage.getItem(POSITION_KEY);
				if (raw) {
					const p = JSON.parse(raw);
					if (
						p !== null &&
						typeof p === "object" &&
						typeof p.x === "number" &&
						typeof p.y === "number" &&
						Number.isFinite(p.x) &&
						Number.isFinite(p.y)
					) {
						return { x: p.x, y: p.y };
					}
				}
			} catch {}
			return null;
		}

		function loadGlass() {
			try {
				const raw = localStorage.getItem(GLASS_KEY);
				if (raw) {
					const g = JSON.parse(raw);
					if (g !== null && typeof g === "object") {
						const out = { ...DEFAULT_GLASS };
						for (const key of Object.keys(DEFAULT_GLASS)) {
							const value = g[key];
							if (typeof value === "number" && Number.isFinite(value)) {
								out[key] = value;
							} else if (typeof value === "boolean" && (key === "enable3d" || key === "colorEnabled")) {
								out[key] = value;
							} else if (typeof value === "string" && key === "color" && /^#[0-9a-fA-F]{6}$/.test(value)) {
								out[key] = value;
							} else if (typeof value === "string" && key === "currency" && ["CNY", "USD", "auto"].includes(value)) {
								out[key] = value;
							}
						}
						out.alpha = clamp(out.alpha, 0, 80);
						out.blur = clamp(out.blur, 0, 40);
						out.saturate = clamp(out.saturate, 100, 300);
						out.highlight = clamp(out.highlight, 0, 1);
						out.shine = clamp(out.shine, 0, 0.5);
						out.thickness = clamp(out.thickness, 0, 40);
						out.angle = clamp(out.angle, -30, 30);
						out.colorStrength = clamp(out.colorStrength, 0, 100);
						out.cardWidth = clamp(out.cardWidth, 220, 420);
						out.cardHeight = clamp(out.cardHeight, 0, 400);
						return out;
					}
				}
			} catch {}
			return { ...DEFAULT_GLASS };
		}

		function loadCollapsed() {
			try {
				return localStorage.getItem(COLLAPSED_KEY) === "1";
			} catch {}
			return false;
		}

		function loadShowTotal() {
			try {
				return localStorage.getItem(SHOW_TOTAL_KEY) !== "0";
			} catch {}
			return true;
		}

		function GlassSlider(props) {
			const { label, value, min, max, step, unit, onChange, disabled } = props;
			return jsxs("label", {
				className: "dsbc-slider" + (disabled ? " dsbc-disabled" : ""),
				children: [
					jsxs("span", {
						className: "dsbc-slider-head",
						children: [
							jsx("span", { children: label }),
							jsx("span", { className: "dsbc-slider-value", children: `${value}${unit || ""}` })
						]
					}),
					jsx("input", {
						type: "range",
						min: String(min),
						max: String(max),
						step: String(step),
						value: String(value),
						disabled: disabled === true,
						onChange: (e) => onChange(Number(e.target.value))
					})
				]
			});
		}

		/** Value of one daily entry for a chart metric (0 for missing fields). */
		function dailyMetricValue(day, metric, currency) {
			switch (metric) {
				case "cost": return currency === "USD" ? (day.costUsd || 0) : (day.cost || 0);
				case "tokens": return day.totalTokens || 0;
				case "input": return day.inputTokens || 0;
				case "cache": return day.cacheReadTokens || 0;
				case "output": return day.outputTokens || 0;
				default: return 0;
			}
		}

		// ---- daily bar chart (shared by the 本地 and 总计（线上）blocks) ----
		//
		// `days` entries: { date: "YYYY-MM-DD", cost, inputTokens,
		// cacheReadTokens, outputTokens, totalTokens, ... }. The 7d chart labels
		// every bar with its date; the 30d chart has no bottom labels (30 tiny
		// labels would overlap into an unreadable smear at card width) — the
		// date lives in the hover tooltip. The covered date range is printed
		// below the bars so the period is always identifiable.
		function renderDailyChart(days, range, metric, currency, onMetricChange) {
			const values = days.map((d) => dailyMetricValue(d, metric, currency));
			const max = Math.max(1, ...values);
			const showDayLabels = range === "7d";
			return jsxs("div", {
				className: "dsbc-chart",
				children: [
					jsxs("div", {
						className: "dsbc-chart-tabs",
						children: CHART_METRICS.map((m) =>
							jsx("button", {
								type: "button",
								key: m.key,
								className: metric === m.key ? "active" : "",
								onClick: () => onMetricChange(m.key),
								children: m.label
							})
						)
					}),
					jsx("div", {
						className: "dsbc-chart-bars",
						children: days.map((d) => {
							const value = dailyMetricValue(d, metric, currency);
							const pct = Math.max(2, Math.round(value / max * 100));
							const label = metric === "cost" ? formatCost(currency === "USD" ? d.costUsd : d.cost, currency) : formatTokens(value);
							return jsx("div", {
								key: d.date,
								className: "dsbc-chart-col",
								title: `${d.date} · ${label}`,
								children: [
									jsx("div", {
										className: "dsbc-chart-tip",
										children: `${d.date} · ${label}`
									}),
									jsx("div", {
										className: "dsbc-chart-bar-wrap",
										children: jsx("div", {
											className: "dsbc-chart-bar",
											style: { height: `${pct}%` }
										})
									}),
									showDayLabels
										? jsx("div", {
											className: "dsbc-chart-day",
											children: d.date.slice(5)
										})
										: null
								]
							});
						})
					}),
					jsx("div", {
						className: "dsbc-chart-range",
						children: `${days[0].date} ~ ${days[days.length - 1].date}`
					})
				]
			});
		}

		// ---- injected glass styles -------------------------------------
		function injectStyles() {
			const style = document.createElement("style");
			style.textContent = `
				.dsbc-card {
					--dsbc-alpha: 14%;
					--dsbc-alpha2: 7%;
					--dsbc-blur: 4px;
					--dsbc-saturate: 140%;
					--dsbc-highlight: 0.35;
					--dsbc-highlight-weak: 0.07;
					--dsbc-shine: 0.14;
					--dsbc-tint: var(--dsw-alias-bg-overlay, #ffffff);
					--dsbc-layer-alpha: 28%;
					--dsbc-layer-alpha2: 14%;
					--dsbc-thickness: 0px;
					--dsbc-angle: 0deg;
					position: fixed;
					z-index: 9999;
					box-sizing: border-box;
					width: 264px;
					font-family: inherit;
					user-select: none;
					-webkit-user-select: none;
					transform-style: preserve-3d;
					will-change: transform;
					transition: transform 0.2s ease;
				}
				.dsbc-card-content {
					position: relative;
					z-index: 1;
					box-sizing: border-box;
					width: 100%;
					min-height: var(--dsbc-min-height, 0px);
					border-radius: 20px;
					padding: 14px 16px 12px;
					font-size: 12px;
					line-height: 18px;
					color: var(--dsw-alias-label-primary, #1f2328);
					background: var(--dsw-alias-bg-overlay, rgba(255, 255, 255, 0.65));
					border: 1px solid rgba(255, 255, 255, 0.45);
					box-shadow:
						inset 0 1px 0 rgba(255, 255, 255, 0.45),
						inset 0 -1px 0 rgba(255, 255, 255, 0.06),
						inset 0 0 0 1px rgba(255, 255, 255, 0.08),
						0 8px 32px rgba(0, 0, 0, 0.18);
					overflow: hidden;
					transition: box-shadow 0.2s ease, border-color 0.2s ease;
				}
				.dsbc-3d-layer {
					position: absolute;
					inset: 0;
					border-radius: 20px;
					pointer-events: none;
					background: linear-gradient(
						135deg,
						color-mix(in srgb, var(--dsbc-tint, var(--dsw-alias-bg-overlay, #ffffff)) var(--dsbc-layer-alpha, 28%), transparent),
						color-mix(in srgb, var(--dsbc-tint, var(--dsw-alias-bg-overlay, #ffffff)) var(--dsbc-layer-alpha2, 14%), transparent)
					);
					border: 1px solid color-mix(in srgb, var(--dsbc-tint, var(--dsw-alias-bg-overlay, #ffffff)) var(--dsbc-layer-alpha2, 14%), transparent);
					z-index: 0;
					transform-style: preserve-3d;
				}
				.dsbc-card-content::before {
					content: "";
					position: absolute;
					inset: 0;
					border-radius: inherit;
					pointer-events: none;
					background:
						radial-gradient(120% 80% at 15% 0%, rgba(255, 255, 255, var(--dsbc-highlight, 0.35)) 0%, rgba(255, 255, 255, var(--dsbc-highlight-weak, 0.07)) 42%, transparent 70%),
						linear-gradient(135deg, rgba(255, 255, 255, var(--dsbc-highlight-weak, 0.07)) 0%, rgba(255, 255, 255, 0.01) 45%, rgba(255, 255, 255, var(--dsbc-highlight-weak, 0.05)) 100%);
					z-index: 0;
				}
				.dsbc-card-content::after {
					content: "";
					position: absolute;
					top: -60%;
					left: -80%;
					width: 45%;
					height: 220%;
					pointer-events: none;
					background: linear-gradient(100deg, transparent, rgba(255, 255, 255, var(--dsbc-shine, 0.14)), transparent);
					transform: rotate(25deg);
					opacity: 0;
					z-index: 2;
					animation: dsbc-shine 6s ease-in-out infinite;
				}
				.dsbc-card-content > * {
					position: relative;
					z-index: 1;
				}
				.dsbc-card.collapsed .dsbc-card-content > :not(.dsbc-header) {
					display: none;
				}
				.dsbc-card.collapsed .dsbc-card-content {
					padding: 6px 8px;
				}
				.dsbc-card.collapsed .dsbc-header {
					margin-bottom: 0;
					gap: 6px;
				}
				.dsbc-card.collapsed .dsbc-title {
					font-size: 16px;
					font-weight: 700;
					letter-spacing: -0.2px;
				}
				.dsbc-card.collapsed .dsbc-icon-btn {
					width: 22px;
					height: 22px;
				}
				@keyframes dsbc-shine {
					0%, 55% {
						transform: translateX(-160%) rotate(25deg);
						opacity: 0;
					}
					62% {
						opacity: 1;
					}
					80%, 100% {
						transform: translateX(380%) rotate(25deg);
						opacity: 0;
					}
				}
				@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
					.dsbc-card-content {
						background: linear-gradient(
							135deg,
							color-mix(in srgb, var(--dsbc-tint, var(--dsw-alias-bg-overlay, #ffffff)) var(--dsbc-alpha, 14%), transparent),
							color-mix(in srgb, var(--dsbc-tint, var(--dsw-alias-bg-overlay, #ffffff)) var(--dsbc-alpha2, 7%), transparent)
						);
						-webkit-backdrop-filter: blur(var(--dsbc-blur, 4px)) saturate(var(--dsbc-saturate, 140%));
						backdrop-filter: blur(var(--dsbc-blur, 4px)) saturate(var(--dsbc-saturate, 140%));
						border-color: color-mix(in srgb, var(--dsbc-tint, var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.6))) 35%, transparent);
					}
				}
				@media (prefers-reduced-motion: reduce) {
					.dsbc-card-content::after {
						display: none;
					}
				}
				.dsbc-header {
					display: flex;
					align-items: center;
					gap: 8px;
					margin-bottom: 8px;
				}
				.dsbc-drag {
					flex: none;
					cursor: grab;
					padding: 2px 4px;
					border-radius: 6px;
					font-size: 14px;
					line-height: 1;
					letter-spacing: -2px;
					color: var(--dsw-alias-label-tertiary, #8b949e);
				}
				.dsbc-drag:active {
					cursor: grabbing;
				}
				.dsbc-title {
					flex: 1;
					min-width: 0;
					font-weight: 600;
					font-size: 13px;
					white-space: nowrap;
					overflow: hidden;
					text-overflow: ellipsis;
				}
				.dsbc-icon-btn {
					display: inline-flex;
					align-items: center;
					justify-content: center;
					width: 24px;
					height: 24px;
					border: 0;
					border-radius: 8px;
					background: transparent;
					color: var(--dsw-alias-label-secondary, #57606a);
					cursor: pointer;
					padding: 0;
				}
				.dsbc-icon-btn:hover {
					background: linear-gradient(135deg, rgba(255, 255, 255, 0.35), rgba(255, 255, 255, 0.1));
					-webkit-backdrop-filter: blur(6px);
					backdrop-filter: blur(6px);
					box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35), 0 1px 3px rgba(0, 0, 0, 0.06);
				}
				.dsbc-icon-btn:disabled {
					opacity: 0.5;
					cursor: default;
				}
				.dsbc-icon-btn svg {
					display: block;
				}
				@keyframes dsbc-spin {
					to {
						transform: rotate(360deg);
					}
				}
				.dsbc-balance-row {
					display: flex;
					align-items: baseline;
					gap: 8px;
				}
				.dsbc-balance-value {
					font-size: 24px;
					line-height: 32px;
					font-weight: 700;
					font-variant-numeric: tabular-nums;
					white-space: nowrap;
				}
				.dsbc-chip {
					flex: none;
					border-radius: 999px;
					padding: 0 8px;
					font-size: 10px;
					line-height: 16px;
				}
				.dsbc-meta {
					display: flex;
					gap: 8px;
					margin-top: 6px;
					color: var(--dsw-alias-label-secondary, #57606a);
					font-size: 11px;
					line-height: 16px;
					white-space: nowrap;
					overflow: hidden;
				}
				.dsbc-meta span {
					overflow: hidden;
					text-overflow: ellipsis;
				}
				.dsbc-updated {
					margin-top: 2px;
					color: var(--dsw-alias-label-tertiary, #8b949e);
					font-size: 10px;
					line-height: 14px;
					font-variant-numeric: tabular-nums;
				}
				.dsbc-error {
					color: var(--dsw-alias-state-error-primary, #cf222e);
					font-size: 11px;
					line-height: 16px;
					word-break: break-word;
				}
				.dsbc-loading {
					color: var(--dsw-alias-label-secondary, #57606a);
				}
				.dsbc-settings {
					margin-top: 8px;
					padding: 10px 12px;
					border-radius: 12px;
					background: color-mix(in srgb, var(--dsw-alias-bg-overlay, #ffffff) 62%, transparent);
					border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.06));
					display: flex;
					flex-direction: column;
					gap: 8px;
					max-height: min(60vh, 420px);
					overflow-y: auto;
					overscroll-behavior: contain;
					scrollbar-width: thin;
					scrollbar-color: rgba(255, 255, 255, 0.45) transparent;
				}
				.dsbc-settings::-webkit-scrollbar {
					width: 6px;
				}
				.dsbc-settings::-webkit-scrollbar-thumb {
					background: linear-gradient(180deg, rgba(255, 255, 255, 0.55), rgba(255, 255, 255, 0.2));
					border: 1px solid rgba(255, 255, 255, 0.3);
					border-radius: 3px;
					box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.4), 0 1px 2px rgba(0, 0, 0, 0.08);
				}
				.dsbc-settings::-webkit-scrollbar-track {
					background: transparent;
				}
				.dsbc-settings-title {
					font-weight: 600;
				}
				.dsbc-settings-info {
					font-size: 10px;
					line-height: 14px;
					color: var(--dsw-alias-label-secondary, #57606a);
					word-break: break-word;
				}
				.dsbc-settings input:not([type="range"]) {
					box-sizing: border-box;
					width: 100%;
					padding: 6px 8px;
					border-radius: 8px;
					border: 1px solid rgba(255, 255, 255, 0.35);
					background: color-mix(in srgb, var(--dsw-alias-bg-field, #ffffff) 55%, transparent);
					-webkit-backdrop-filter: blur(6px);
					backdrop-filter: blur(6px);
					box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.3);
					color: var(--dsw-alias-label-primary, #1f2328);
					font-size: 12px;
				}
				.dsbc-settings-actions {
					display: flex;
					gap: 8px;
				}
				.dsbc-settings-actions button {
					padding: 4px 10px;
					border-radius: 8px;
					border: 1px solid rgba(255, 255, 255, 0.35);
					background: linear-gradient(135deg, rgba(255, 255, 255, 0.3), rgba(255, 255, 255, 0.08));
					-webkit-backdrop-filter: blur(6px);
					backdrop-filter: blur(6px);
					box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35), 0 1px 4px rgba(0, 0, 0, 0.08);
					color: var(--dsw-alias-label-primary, #1f2328);
					cursor: pointer;
					font-size: 11px;
					transition: background 0.2s ease, box-shadow 0.2s ease;
				}
				.dsbc-settings-actions button:hover:not(:disabled) {
					background: linear-gradient(135deg, rgba(255, 255, 255, 0.42), rgba(255, 255, 255, 0.14));
					box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5), 0 2px 6px rgba(0, 0, 0, 0.1);
				}
				.dsbc-settings-actions button:disabled {
					opacity: 0.5;
					cursor: default;
				}
				.dsbc-settings-msg {
					font-size: 10px;
					line-height: 14px;
				}
				.dsbc-settings-msg-ok {
					color: var(--dsw-alias-state-success-primary, #1a7f37);
				}
				.dsbc-settings-msg-error {
					color: var(--dsw-alias-state-error-primary, #cf222e);
				}
				.dsbc-section {
					margin-top: 6px;
					padding-top: 8px;
					border-top: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.06));
					display: flex;
					flex-direction: column;
					gap: 8px;
				}
				.dsbc-slider {
					display: flex;
					flex-direction: column;
					gap: 4px;
				}
				.dsbc-slider-head {
					display: flex;
					align-items: center;
					justify-content: space-between;
					gap: 8px;
					font-size: 11px;
					line-height: 16px;
				}
				.dsbc-slider-value {
					color: var(--dsw-alias-label-secondary, #57606a);
					font-variant-numeric: tabular-nums;
					white-space: nowrap;
				}
				.dsbc-slider {
					position: relative;
					z-index: 2;
				}
				.dsbc-slider input[type="range"] {
					-webkit-appearance: none;
					appearance: none;
					box-sizing: border-box;
					position: relative;
					z-index: 3;
					pointer-events: auto;
					touch-action: none;
					width: 100%;
					height: 20px;
					margin: 0;
					padding: 0;
					background: transparent;
					cursor: pointer;
				}
				.dsbc-slider input[type="range"]::-webkit-slider-runnable-track {
					height: 4px;
					border-radius: 999px;
					background: linear-gradient(90deg, rgba(255, 255, 255, 0.22), rgba(255, 255, 255, 0.06));
					border: 1px solid rgba(255, 255, 255, 0.16);
					box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.12);
				}
				.dsbc-slider input[type="range"]::-webkit-slider-thumb {
					-webkit-appearance: none;
					appearance: none;
					width: 16px;
					height: 16px;
					margin-top: -7px;
					border-radius: 50%;
					border: 1px solid rgba(255, 255, 255, 0.85);
					background:
						radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.95) 0%, rgba(255, 255, 255, 0.4) 38%, rgba(255, 255, 255, 0.12) 100%);
					box-shadow:
						inset 0 1px 2px rgba(255, 255, 255, 0.85),
						inset 0 -2px 4px rgba(255, 255, 255, 0.12),
						0 2px 8px rgba(0, 0, 0, 0.25),
						0 0 0 3px rgba(255, 255, 255, 0.12);
					transition: transform 0.15s ease, box-shadow 0.15s ease;
				}
				.dsbc-slider input[type="range"]::-webkit-slider-thumb:hover {
					transform: scale(1.12);
					box-shadow:
						inset 0 1px 3px rgba(255, 255, 255, 0.95),
						inset 0 -2px 5px rgba(255, 255, 255, 0.15),
						0 3px 12px rgba(0, 0, 0, 0.3),
						0 0 0 4px rgba(255, 255, 255, 0.16);
				}
				.dsbc-slider input[type="range"]::-webkit-slider-thumb:active {
					transform: scale(0.96);
				}
				.dsbc-slider input[type="range"]::-moz-range-track {
					height: 4px;
					border-radius: 999px;
					background: linear-gradient(90deg, rgba(255, 255, 255, 0.22), rgba(255, 255, 255, 0.06));
					border: 1px solid rgba(255, 255, 255, 0.16);
					box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.12);
				}
				.dsbc-slider input[type="range"]::-moz-range-thumb {
					width: 16px;
					height: 16px;
					border-radius: 50%;
					border: 1px solid rgba(255, 255, 255, 0.85);
					background:
						radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.95) 0%, rgba(255, 255, 255, 0.4) 38%, rgba(255, 255, 255, 0.12) 100%);
					box-shadow:
						inset 0 1px 2px rgba(255, 255, 255, 0.85),
						inset 0 -2px 4px rgba(255, 255, 255, 0.12),
						0 2px 8px rgba(0, 0, 0, 0.25),
						0 0 0 3px rgba(255, 255, 255, 0.12);
					transition: transform 0.15s ease, box-shadow 0.15s ease;
				}
				.dsbc-slider input[type="range"]::-moz-range-thumb:hover {
					transform: scale(1.12);
					box-shadow:
						inset 0 1px 3px rgba(255, 255, 255, 0.95),
						inset 0 -2px 5px rgba(255, 255, 255, 0.15),
						0 3px 12px rgba(0, 0, 0, 0.3),
						0 0 0 4px rgba(255, 255, 255, 0.16);
				}
				.dsbc-slider input[type="range"]:disabled {
					opacity: 0.5;
					cursor: default;
				}
				.dsbc-settings-reset {
					align-self: flex-start;
					padding: 4px 10px;
					border-radius: 8px;
					border: 1px solid rgba(255, 255, 255, 0.35);
					background: linear-gradient(135deg, rgba(255, 255, 255, 0.3), rgba(255, 255, 255, 0.08));
					-webkit-backdrop-filter: blur(6px);
					backdrop-filter: blur(6px);
					box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35), 0 1px 4px rgba(0, 0, 0, 0.08);
					color: var(--dsw-alias-label-primary, #1f2328);
					cursor: pointer;
					font-size: 11px;
					transition: background 0.2s ease, box-shadow 0.2s ease;
				}
				.dsbc-settings-reset:hover {
					background: linear-gradient(135deg, rgba(255, 255, 255, 0.42), rgba(255, 255, 255, 0.14));
					box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5), 0 2px 6px rgba(0, 0, 0, 0.1);
				}
				.dsbc-disabled {
					opacity: 0.5;
				}
				.dsbc-check {
					display: flex;
					align-items: center;
					gap: 6px;
					font-size: 11px;
					line-height: 16px;
					cursor: pointer;
				}
				.dsbc-check input[type="checkbox"] {
					width: auto;
					height: auto;
					margin: 0;
					accent-color: #4f8cff;
				}
				.dsbc-select-row {
					display: flex;
					align-items: center;
					justify-content: space-between;
					gap: 8px;
					font-size: 11px;
					line-height: 16px;
					color: var(--dsw-alias-label-secondary, #57606a);
				}
				.dsbc-select-row select {
					box-sizing: border-box;
					padding: 4px 6px;
					border-radius: 8px;
					border: 1px solid rgba(255, 255, 255, 0.35);
					background: color-mix(in srgb, var(--dsw-alias-bg-field, #ffffff) 60%, transparent);
					-webkit-backdrop-filter: blur(6px);
					backdrop-filter: blur(6px);
					color: var(--dsw-alias-label-primary, #1f2328);
					font-size: 11px;
				}
				.dsbc-color-row {
					display: flex;
					align-items: center;
					gap: 8px;
					font-size: 11px;
					line-height: 16px;
					color: var(--dsw-alias-label-secondary, #57606a);
				}
				.dsbc-color-row input[type="color"] {
					width: 34px;
					height: 22px;
					padding: 0;
					border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));
					border-radius: 6px;
					background: transparent;
					cursor: pointer;
				}
				.dsbc-color-row input[type="color"]:disabled {
					opacity: 0.4;
					cursor: default;
				}
				.dsbc-stats {
					margin-top: 8px;
					padding-top: 8px;
					border-top: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.06));
					display: flex;
					flex-direction: column;
					gap: 4px;
				}
				.dsbc-range-tabs {
					display: flex;
					flex-wrap: wrap;
					gap: 4px;
					margin-bottom: 2px;
				}
				.dsbc-range-tabs button {
					border: 1px solid rgba(255, 255, 255, 0.3);
					border-radius: 999px;
					padding: 1px 8px;
					font-size: 10px;
					line-height: 16px;
					cursor: pointer;
					color: var(--dsw-alias-label-secondary, #57606a);
					background: linear-gradient(135deg, rgba(255, 255, 255, 0.28), rgba(255, 255, 255, 0.06));
					-webkit-backdrop-filter: blur(6px);
					backdrop-filter: blur(6px);
					box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.3), 0 1px 3px rgba(0, 0, 0, 0.06);
					transition: background 0.2s ease, box-shadow 0.2s ease;
				}
				.dsbc-range-tabs button:hover {
					background: linear-gradient(135deg, rgba(255, 255, 255, 0.4), rgba(255, 255, 255, 0.12));
					box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45), 0 1px 4px rgba(0, 0, 0, 0.08);
				}
				.dsbc-range-tabs button.active {
					color: #fff;
					background: linear-gradient(135deg, rgba(79, 140, 255, 0.85), rgba(79, 140, 255, 0.5));
					box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.4), 0 2px 6px rgba(79, 140, 255, 0.25);
				}
				.dsbc-stats-row {
					display: flex;
					align-items: center;
					justify-content: space-between;
					gap: 8px;
					font-size: 11px;
					line-height: 16px;
					color: var(--dsw-alias-label-secondary, #57606a);
				}
				.dsbc-stats-value {
					color: var(--dsw-alias-label-primary, #1f2328);
					font-weight: 600;
					font-variant-numeric: tabular-nums;
					white-space: nowrap;
				}
				.dsbc-stats-loading {
					font-size: 10px;
					line-height: 14px;
					color: var(--dsw-alias-label-tertiary, #8b949e);
				}
				.dsbc-stats-caption {
					margin-top: 4px;
					font-size: 10px;
					line-height: 14px;
					font-weight: 600;
					letter-spacing: 0.4px;
					color: var(--dsw-alias-label-tertiary, #8b949e);
				}
				/* One 本地 / 总计（线上）block: separated by the same hairline the
				   page uses elsewhere, with its rows and chart grouped together. */
				.dsbc-stats-block {
					margin-top: 6px;
					padding-top: 6px;
					border-top: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.06));
					display: flex;
					flex-direction: column;
					gap: 4px;
				}
				.dsbc-stats-block .dsbc-stats-caption {
					margin-top: 0;
				}
				.dsbc-stats-hint {
					font-size: 10px;
					line-height: 14px;
					color: var(--dsw-alias-label-tertiary, #8b949e);
					word-break: break-word;
				}
				.dsbc-chart {
					margin-top: 6px;
					padding-top: 6px;
					border-top: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.06));
					display: flex;
					flex-direction: column;
					gap: 4px;
				}
				.dsbc-chart-tabs {
					display: flex;
					flex-wrap: wrap;
					gap: 4px;
				}
				.dsbc-chart-tabs button {
					border: 1px solid rgba(255, 255, 255, 0.3);
					border-radius: 999px;
					padding: 1px 8px;
					font-size: 10px;
					line-height: 16px;
					cursor: pointer;
					color: var(--dsw-alias-label-secondary, #57606a);
					background: linear-gradient(135deg, rgba(255, 255, 255, 0.28), rgba(255, 255, 255, 0.06));
					-webkit-backdrop-filter: blur(6px);
					backdrop-filter: blur(6px);
					box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.3), 0 1px 3px rgba(0, 0, 0, 0.06);
					transition: background 0.2s ease, box-shadow 0.2s ease;
				}
				.dsbc-chart-tabs button.active {
					color: #fff;
					background: linear-gradient(135deg, rgba(79, 140, 255, 0.85), rgba(79, 140, 255, 0.5));
					box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.4), 0 2px 6px rgba(79, 140, 255, 0.25);
				}
				.dsbc-chart-bars {
					display: flex;
					align-items: flex-end;
					gap: 3px;
					height: 84px;
					padding: 6px 4px 3px;
					border-radius: 12px;
					border: 1px solid rgba(255, 255, 255, 0.2);
					background: linear-gradient(135deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.05));
					-webkit-backdrop-filter: blur(8px);
					backdrop-filter: blur(8px);
					box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.3), 0 2px 8px rgba(0, 0, 0, 0.06);
				}
				.dsbc-chart-col {
					position: relative;
					flex: 1;
					min-width: 0;
					height: 100%;
					display: flex;
					flex-direction: column;
					align-items: center;
					gap: 2px;
				}
				.dsbc-chart-tip {
					position: absolute;
					bottom: calc(100% + 6px);
					left: 50%;
					transform: translateX(-50%) scale(0.9);
					transform-origin: bottom center;
					opacity: 0;
					pointer-events: none;
					white-space: nowrap;
					z-index: 6;
					padding: 4px 8px;
					border-radius: 8px;
					border: 1px solid rgba(255, 255, 255, 0.35);
					background: color-mix(in srgb, var(--dsw-alias-bg-overlay, #ffffff) 78%, transparent);
					-webkit-backdrop-filter: blur(10px);
					backdrop-filter: blur(10px);
					box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.4), 0 4px 12px rgba(0, 0, 0, 0.18);
					font-size: 10px;
					line-height: 14px;
					color: var(--dsw-alias-label-primary, #1f2328);
					transition: opacity 0.15s ease, transform 0.15s ease;
				}
				.dsbc-chart-col:hover .dsbc-chart-tip {
					opacity: 1;
					transform: translateX(-50%) scale(1);
				}
				.dsbc-chart-bar-wrap {
					flex: 1;
					width: 100%;
					display: flex;
					align-items: flex-end;
					justify-content: center;
				}
				.dsbc-chart-bar {
					width: 65%;
					min-height: 2px;
					border-radius: 4px 4px 2px 2px;
					background: linear-gradient(180deg, rgba(255, 255, 255, 0.85), rgba(79, 140, 255, 0.6));
					box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5), 0 1px 3px rgba(0, 0, 0, 0.15);
					transition: height 0.2s ease;
				}
				.dsbc-chart-day {
					font-size: 9px;
					line-height: 12px;
					color: var(--dsw-alias-label-tertiary, #8b949e);
					white-space: nowrap;
				}
				.dsbc-chart-range {
					font-size: 9px;
					line-height: 12px;
					color: var(--dsw-alias-label-tertiary, #8b949e);
					text-align: right;
					white-space: nowrap;
					font-variant-numeric: tabular-nums;
				}
				.dsbc-footer {
					display: flex;
					align-items: center;
					justify-content: space-between;
					gap: 8px;
					margin-top: 8px;
				}
				.dsbc-recharge {
					display: inline-flex;
					align-items: center;
					gap: 4px;
					font-size: 11px;
					font-weight: 600;
					color: var(--dsw-alias-label-link, #0969da);
					text-decoration: none;
					padding: 2px 8px;
					border-radius: 8px;
				}
				.dsbc-recharge:hover {
					background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
					text-decoration: underline;
				}
			`;
			document.head.appendChild(style);
			return style;
		}

		// ---- the widget -------------------------------------------------
		function DeepSeekBalanceCard(props) {
			const controller = props && props.controller ? props.controller : null;
			const [data, setData] = useState(null);
			const [phase, setPhase] = useState("loading"); // loading | ready | error
			const [message, setMessage] = useState("");
			const [updatedAt, setUpdatedAt] = useState(null);
			const [spinning, setSpinning] = useState(false);
			const [settingsOpen, setSettingsOpen] = useState(false);
			const [settingsInfo, setSettingsInfo] = useState(null);
			const [apiKey, setApiKey] = useState("");
			const [saving, setSaving] = useState(false);
			const [settingsMessage, setSettingsMessage] = useState(null); // { type, text }
			const [refreshSeconds, setRefreshSeconds] = useState(60);
			const [onlineRefreshSeconds, setOnlineRefreshSeconds] = useState(300);
			const [pos, setPos] = useState(loadPosition);
			const [glass, setGlass] = useState(loadGlass);
			const [stats, setStats] = useState(null);
			const [statsRange, setStatsRange] = useState("today");
			const [statsLoading, setStatsLoading] = useState(false);
			const [chartMetric, setChartMetric] = useState("cost"); // cost | tokens
			const [collapsed, setCollapsed] = useState(loadCollapsed);
			const [onlineStats, setOnlineStats] = useState(null);
			const [onlineLoading, setOnlineLoading] = useState(false);
			const [onlineError, setOnlineError] = useState("");
			const [showTotal, setShowTotal] = useState(loadShowTotal);
			const [platformToken, setPlatformToken] = useState("");
			const [savingPlatform, setSavingPlatform] = useState(false);
			const [platformMessage, setPlatformMessage] = useState(null); // { type, text }

			// Derived values must be declared before any hook whose deps array
			// references them — React evaluates deps arrays eagerly during render.
			const payload = data && data.balance ? data.balance : null;
			const balanceList = payload && Array.isArray(payload.balance_infos) ? payload.balance_infos : [];
			const balance = glass.currency === "auto"
				? (balanceList.find((b) => b && b.currency === "CNY") || balanceList[0] || null)
				: (balanceList.find((b) => b && b.currency === glass.currency) || balanceList[0] || null);
			const available = payload ? payload.is_available !== false : null;
			const currency = balance && balance.currency ? balance.currency : "CNY";
			const sourceLabel = data && data.source === "harness" ? "DSH Key" : data && data.source === "manual" ? "手动 Key" : "";
			const dailyData = stats && Array.isArray(stats.daily) ? stats.daily : [];
			const onlineCurrency =
				onlineStats && typeof onlineStats.currency === "string" && onlineStats.currency !== ""
					? onlineStats.currency
					: currency;

			const posRef = useRef(pos);
			const drag = useRef(null);
			const cardRef = useRef(null);
			const settingsRef = useRef(null);
			const settingsScrollTop = useRef(0);
			const settingsScrollPending = useRef(false);

			useEffect(() => {
				posRef.current = pos;
			}, [pos]);

			useEffect(() => {
				try {
					localStorage.setItem(GLASS_KEY, JSON.stringify(glass));
				} catch {}
			}, [glass]);

			useEffect(() => {
				try {
					localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
				} catch {}
			}, [collapsed]);

			useEffect(() => {
				try {
					localStorage.setItem(SHOW_TOTAL_KEY, showTotal ? "1" : "0");
				} catch {}
			}, [showTotal]);

			useLayoutEffect(() => {
				if (settingsScrollPending.current && settingsRef.current) {
					settingsRef.current.scrollTop = settingsScrollTop.current;
					settingsScrollPending.current = false;
				}
			}, [glass]);

			const load = useCallback(async () => {
				setSpinning(true);
				try {
					const res = await fetch(BALANCE_PATH, { cache: "no-store" });
					const body = await res.json().catch(() => null);
					if (!res.ok) {
						const error = new Error(
							body && typeof body.message === "string" ? body.message : `请求失败（HTTP ${res.status}）`
						);
						error.code = body && typeof body.error === "string" ? body.error : `http-${res.status}`;
						throw error;
					}
					if (!body || body.ok !== true) {
						throw new Error("余额接口返回了无法识别的数据");
					}
					setData(body);
					setPhase("ready");
					setMessage("");
					setUpdatedAt(new Date());
				} catch (error) {
					setPhase("error");
					setMessage(error instanceof Error ? error.message : String(error));
				} finally {
					setSpinning(false);
				}
			}, []);

			useEffect(() => {
				if (!controller) return;
				return controller.subscribe(() => {
					const snap = controller.snapshot();
					const raw = snap && snap.refreshSeconds ? snap.refreshSeconds.text : null;
					const n = raw === null || raw === "" ? 60 : Number(raw);
					if (Number.isFinite(n) && n > 0 && n !== refreshSeconds) setRefreshSeconds(n);
					const rawOnline = snap && snap.onlineRefreshSeconds ? snap.onlineRefreshSeconds.text : null;
					const on = rawOnline === null || rawOnline === "" ? 300 : Number(rawOnline);
					if (Number.isFinite(on) && on > 0 && on !== onlineRefreshSeconds) setOnlineRefreshSeconds(on);
				});
			}, [controller, refreshSeconds, onlineRefreshSeconds]);

			useEffect(() => {
				load();
				const seconds = Number.isFinite(refreshSeconds) && refreshSeconds > 0 ? refreshSeconds : 60;
				const timer = setInterval(load, seconds * 1000);
				return () => clearInterval(timer);
			}, [load, refreshSeconds]);

			// Local stats are cached per range (short TTL) so switching back to a
			// previously viewed range renders instantly instead of re-aggregating
			// session logs. The manual refresh button forces a fresh fetch.
			//
			// Request markers guard against out-of-order responses: fast tab
			// switching can leave an older range's request in flight, and its
			// late response must not overwrite the currently selected range.
			const statsCacheRef = useRef(new Map());
			const statsRequestRef = useRef("");
			const loadStats = useCallback(async (range, force) => {
				const key = range || "today";
				statsRequestRef.current = key;
				if (force !== true) {
					const cached = statsCacheRef.current.get(key);
					if (cached !== void 0 && Date.now() - cached.at < 60000) {
						setStats(cached.data);
						// The current range is ready; the previous in-flight
						// request is stale (its finally is guarded by the ref)
						// and must not leave the loading flag stuck.
						setStatsLoading(false);
						return;
					}
				}
				setStatsLoading(true);
				try {
					const res = await fetch(`${STATS_PATH}?range=${encodeURIComponent(key)}`, { cache: "no-store" });
					const body = await res.json().catch(() => null);
					if (body && body.ok === true) {
						statsCacheRef.current.set(key, { at: Date.now(), data: body });
						if (statsRequestRef.current === key) setStats(body);
					}
				} catch {}
				finally {
					if (statsRequestRef.current === key) setStatsLoading(false);
				}
			}, []);

			const onlineRequestRef = useRef("");
			const loadOnlineStats = useCallback(async (range, preferredCurrency, force) => {
				const key = range || "today";
				onlineRequestRef.current = key;
				setOnlineLoading(true);
				try {
					const query = `?range=${encodeURIComponent(key)}${preferredCurrency ? `&currency=${encodeURIComponent(preferredCurrency)}` : ""}${force === true ? "&force=1" : ""}`;
					const res = await fetch(`${ONLINE_STATS_PATH}${query}`, { cache: "no-store" });
					const body = await res.json().catch(() => null);
					if (onlineRequestRef.current !== key) return;
					if (body && body.ok === true) {
						setOnlineStats(body);
						setOnlineError("");
					} else {
						setOnlineError(body && typeof body.message === "string" ? body.message : `线上统计请求失败（HTTP ${res.status}）`);
					}
				} catch (error) {
					if (onlineRequestRef.current === key) setOnlineError(error instanceof Error ? error.message : String(error));
				} finally {
					if (onlineRequestRef.current === key) setOnlineLoading(false);
				}
			}, []);

			useEffect(() => {
				loadStats(statsRange);
			}, [statsRange, loadStats]);

			useEffect(() => {
				loadOnlineStats(statsRange, currency);
			}, [statsRange, currency, loadOnlineStats]);

			// Online totals auto-refresh (configurable in the plugin config card;
			// defaults to 300 s since platform data lags and "all" walks months).
			useEffect(() => {
				const seconds = Number.isFinite(onlineRefreshSeconds) && onlineRefreshSeconds > 0 ? onlineRefreshSeconds : 300;
				const timer = setInterval(() => loadOnlineStats(statsRange, currency), seconds * 1000);
				return () => clearInterval(timer);
			}, [onlineRefreshSeconds, loadOnlineStats, statsRange, currency]);

			const refreshSettings = useCallback(async () => {
				try {
					const res = await fetch(SETTINGS_PATH, { cache: "no-store" });
					const body = await res.json();
					if (body && body.ok === true) setSettingsInfo(body);
				} catch {}
			}, []);

			const openSettings = useCallback(() => {
				setSettingsOpen(true);
				setSettingsMessage(null);
				setApiKey("");
				refreshSettings();
			}, [refreshSettings]);

			const saveKey = useCallback(async () => {
				const key = apiKey.trim();
				if (!key || !controller) return;
				setSaving(true);
				setSettingsMessage(null);
				try {
					const landed = await controller.writeToken(key);
					setSettingsMessage(
						landed
							? { type: "ok", text: "已保存手动 Key（存于 DSH 凭据系统）" }
							: { type: "error", text: "保存失败：宿主没有接受该密钥" }
					);
					setApiKey("");
					await refreshSettings();
					load();
				} catch (error) {
					setSettingsMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
				} finally {
					setSaving(false);
				}
			}, [apiKey, controller, load, refreshSettings]);

			const clearKey = useCallback(async () => {
				if (!controller) return;
				setSaving(true);
				setSettingsMessage(null);
				try {
					const cleared = await controller.clearToken();
					setSettingsMessage(cleared ? { type: "ok", text: "已清除手动 Key" } : { type: "error", text: "清除失败：宿主仍持有该密钥" });
					setApiKey("");
					await refreshSettings();
					load();
				} catch (error) {
					setSettingsMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
				} finally {
					setSaving(false);
				}
			}, [controller, load, refreshSettings]);

			const savePlatformToken = useCallback(async () => {
				const token = platformToken.trim();
				if (!token || !controller) return;
				setSavingPlatform(true);
				setPlatformMessage(null);
				try {
					const landed = await controller.writePlatformToken(token);
					setPlatformMessage(
						landed
							? { type: "ok", text: "已保存平台 Token（存于 DSH 凭据系统）" }
							: { type: "error", text: "保存失败：宿主没有接受该 Token" }
					);
					setPlatformToken("");
					await refreshSettings();
					loadOnlineStats(statsRange, currency);
				} catch (error) {
					setPlatformMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
				} finally {
					setSavingPlatform(false);
				}
			}, [platformToken, controller, refreshSettings, loadOnlineStats, statsRange, currency]);

			const clearPlatformToken = useCallback(async () => {
				if (!controller) return;
				setSavingPlatform(true);
				setPlatformMessage(null);
				try {
					const cleared = await controller.clearPlatformToken();
					setPlatformMessage(cleared ? { type: "ok", text: "已清除平台 Token" } : { type: "error", text: "清除失败：宿主仍持有该 Token" });
					setPlatformToken("");
					await refreshSettings();
					loadOnlineStats(statsRange, currency);
				} catch (error) {
					setPlatformMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
				} finally {
					setSavingPlatform(false);
				}
			}, [controller, refreshSettings, loadOnlineStats, statsRange, currency]);

			const updateGlass = useCallback((key, value) => {
				if (settingsRef.current) {
					settingsScrollTop.current = settingsRef.current.scrollTop;
					settingsScrollPending.current = true;
				}
				setGlass((prev) => ({ ...prev, [key]: value }));
			}, []);

			const resetGlass = useCallback(() => {
				setGlass({ ...DEFAULT_GLASS });
			}, []);

			// ---- drag ---------------------------------------------------
			const handlePointerDown = (e) => {
				if (e.button !== 0) return;
				const rect = cardRef.current.getBoundingClientRect();
				drag.current = {
					pointerId: e.pointerId,
					startX: e.clientX,
					startY: e.clientY,
					left: rect.left,
					top: rect.top
				};
				e.currentTarget.setPointerCapture(e.pointerId);
			};

			const handlePointerMove = (e) => {
				const d = drag.current;
				if (!d || e.pointerId !== d.pointerId) return;
				const width = cardRef.current ? cardRef.current.offsetWidth : CARD_WIDTH;
				const height = cardRef.current ? cardRef.current.offsetHeight : CARD_HEIGHT;
				const x = clamp(d.left + e.clientX - d.startX, 0, Math.max(0, window.innerWidth - width));
				const y = clamp(d.top + e.clientY - d.startY, 0, Math.max(0, window.innerHeight - height));
				d.currentX = x;
				d.currentY = y;
				setPos({ x, y });
			};

			const handlePointerUp = (e) => {
				const d = drag.current;
				if (d && e.pointerId === d.pointerId) {
					const p =
						typeof d.currentX === "number" && typeof d.currentY === "number"
							? { x: d.currentX, y: d.currentY }
							: posRef.current;
					if (p) {
						try {
							localStorage.setItem(POSITION_KEY, JSON.stringify(p));
						} catch {}
					}
				}
				drag.current = null;
			};

			const stateColor =
				phase === "error"
					? "var(--dsw-alias-state-error-primary, #cf222e)"
					: available === false
						? "var(--dsw-alias-state-error-primary, #cf222e)"
						: "var(--dsw-alias-state-success-primary, #1a7f37)";

			let chip = null;
			if (phase === "ready") {
				chip = jsx("span", {
					className: "dsbc-chip",
					style: { color: stateColor, background: "var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.06))" },
					children: available === false ? "不可用" : "可用"
				});
			} else if (phase === "error") {
				chip = jsx("span", {
					className: "dsbc-chip",
					style: { color: stateColor },
					children: "错误"
				});
			}

			const refreshIcon = jsx("svg", {
				width: 14,
				height: 14,
				viewBox: "0 0 16 16",
				fill: "none",
				style: spinning ? { animation: "dsbc-spin 0.8s linear infinite" } : void 0,
				children: jsx("path", {
					d: "M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 1.5v3h-3",
					stroke: "currentColor",
					strokeWidth: 1.5,
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})
			});

			const gearIcon = jsx("svg", {
				width: 14,
				height: 14,
				viewBox: "0 0 16 16",
				fill: "none",
				children: jsxs(Fragment, {
					children: [
						jsx("circle", { cx: 8, cy: 8, r: 2.2, stroke: "currentColor", strokeWidth: 1.4 }),
						jsx("path", {
							d: "M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M12.4 3.6L11 5M5 11l-1.4 1.4",
							stroke: "currentColor",
							strokeWidth: 1.3,
							strokeLinecap: "round"
						})
					]
				})
			});

			const chevronIcon = jsx("svg", {
				width: 14,
				height: 14,
				viewBox: "0 0 16 16",
				fill: "none",
				style: collapsed ? {} : { transform: "rotate(180deg)" },
				children: jsx("path", {
					d: "M4 6l4 4 4-4",
					stroke: "currentColor",
					strokeWidth: 1.5,
					strokeLinecap: "round",
					strokeLinejoin: "round"
				})
			});

			const effectiveAlpha = glass.colorEnabled ? Math.round(glass.alpha * glass.colorStrength / 100) : glass.alpha;
			const effectiveAlpha2 = Math.max(0, Math.round(effectiveAlpha / 2));
			const layerAlpha = glass.colorEnabled ? Math.max(0, Math.round(glass.colorStrength * 0.3)) : 28;
			const layerAlpha2 = Math.max(0, Math.round(layerAlpha / 2));
			const glassStyle = {
				"--dsbc-alpha": `${effectiveAlpha}%`,
				"--dsbc-alpha2": `${effectiveAlpha2}%`,
				"--dsbc-blur": `${glass.blur}px`,
				"--dsbc-saturate": `${glass.saturate}%`,
				"--dsbc-highlight": String(glass.highlight),
				"--dsbc-highlight-weak": String(Math.max(0, glass.highlight * 0.2)),
				"--dsbc-shine": String(glass.shine),
				"--dsbc-tint": glass.colorEnabled ? glass.color : "var(--dsw-alias-bg-overlay, #ffffff)",
				"--dsbc-layer-alpha": `${layerAlpha}%`,
				"--dsbc-layer-alpha2": `${layerAlpha2}%`,
				"--dsbc-thickness": `${glass.enable3d ? glass.thickness : 0}px`,
				"--dsbc-angle": `${glass.enable3d ? glass.angle : 0}deg`,
				"--dsbc-min-height": `${glass.cardHeight}px`
			};
			const cardStyle = {
				...glassStyle,
				width: `${glass.cardWidth}px`,
				...(glass.enable3d
					? {
						transform: `perspective(900px) rotateY(${glass.angle}deg)`,
						transformStyle: "preserve-3d"
					}
					: {}),
				...(pos ? { left: pos.x, top: pos.y } : { top: 16, right: 16 })
			};

			const layerStep = 4;
			const layerCount = glass.enable3d && glass.thickness > 0 ? Math.max(1, Math.ceil(glass.thickness / layerStep)) : 0;
			const layers = Array.from({ length: layerCount }, (_, i) =>
				jsx("div", {
					key: i,
					className: "dsbc-3d-layer",
					style: { transform: `translateZ(${-Math.round((i + 1) * layerStep)}px)` }
				})
			);

			return jsx("div", {
				className: "dsbc-card" + (collapsed ? " collapsed" : ""),
				ref: cardRef,
				role: "status",
				"aria-live": "polite",
				"data-plugin": "dsh-liquid-glass-balance-card",
				style: cardStyle,
				children: jsxs(Fragment, {
					children: [
						...layers,
						jsx("div", {
							className: "dsbc-card-content",
							children: jsxs(Fragment, {
								children: [
									jsxs("div", {
										className: "dsbc-header",
							children: [
								jsx("div", {
									className: "dsbc-drag",
									title: "拖动卡片",
									"aria-label": "拖动卡片",
									onPointerDown: handlePointerDown,
									onPointerMove: handlePointerMove,
									onPointerUp: handlePointerUp,
									onPointerCancel: handlePointerUp,
									children: "⠿"
								}),
								jsx("span", {
									className: "dsbc-title",
									children: collapsed ? (balance ? `余额 ${formatBalance(balance.total_balance, currency)}` : "余额") : "DeepSeek 余额"
								}),
								jsx("button", {
									type: "button",
									className: "dsbc-icon-btn",
									"aria-label": "刷新余额与统计",
									title: "刷新",
									disabled: spinning,
									onClick: () => { load(); loadStats(statsRange, true); loadOnlineStats(statsRange, currency, true); },
									children: refreshIcon
								}),
								jsx("button", {
									type: "button",
									className: "dsbc-icon-btn",
									"aria-label": "卡片设置",
									title: "卡片设置",
									onClick: () => {
										if (collapsed) setCollapsed(false);
										if (settingsOpen) setSettingsOpen(false); else openSettings();
									},
									children: gearIcon
								}),
								jsx("button", {
									type: "button",
									className: "dsbc-icon-btn",
									"aria-label": collapsed ? "展开卡片" : "收起卡片",
									title: collapsed ? "展开" : "收起",
									onClick: () => setCollapsed(!collapsed),
									children: chevronIcon
								})
							]
						}),
						phase === "loading"
							? jsx("div", { className: "dsbc-loading", children: "加载中…" })
							: phase === "error"
								? jsx("div", { className: "dsbc-error", title: message, children: message })
								: jsxs(Fragment, {
									children: [
										jsxs("div", {
											className: "dsbc-balance-row",
											children: [
												jsx("span", {
													className: "dsbc-balance-value",
													children: balance ? formatBalance(balance.total_balance, currency) : "—"
												}),
												chip
											]
										}),
										jsxs("div", {
											className: "dsbc-meta",
											children: [
												jsx("span", { children: `赠送 ${balance ? formatBalance(balance.granted_balance, currency) : "—"}` }),
												jsx("span", { children: "·" }),
												jsx("span", { children: `充值 ${balance ? formatBalance(balance.topped_up_balance, currency) : "—"}` }),
												sourceLabel ? jsx("span", { children: `· ${sourceLabel}` }) : null
											]
										}),
										jsxs("div", {
											className: "dsbc-stats",
											children: [
												jsxs("div", {
													className: "dsbc-range-tabs",
													children: Object.keys(RANGE_LABELS).map((key) =>
														jsx("button", {
															type: "button",
															key,
															className: statsRange === key ? "active" : "",
															onClick: () => setStatsRange(key),
															children: RANGE_LABELS[key]
														})
													)
												}),
												jsxs("div", {
													className: "dsbc-stats-block",
													children: [
														jsx("div", { className: "dsbc-stats-caption", children: "本地" }),
														jsxs("div", {
															className: "dsbc-stats-row",
															children: [
																jsx("span", { children: "累计消费" }),
																jsx("span", { className: "dsbc-stats-value", children: stats && stats.range === statsRange ? formatCost(currency === "USD" ? stats.costUsd : stats.cost, currency) : "—" })
															]
														}),
														jsxs("div", {
															className: "dsbc-stats-row",
															children: [
																jsx("span", { children: "累计 Tokens" }),
																jsx("span", { className: "dsbc-stats-value", children: stats && stats.range === statsRange ? formatTokens(stats.totalTokens) : "—" })
															]
														}),
														(statsRange === "7d" || statsRange === "30d") && stats && stats.range === statsRange && dailyData.length > 0
															? renderDailyChart(dailyData, statsRange, chartMetric, currency, setChartMetric)
															: null
													]
												}),
												showTotal
													? jsxs("div", {
														className: "dsbc-stats-block",
														children: [
															jsx("div", { className: "dsbc-stats-caption", children: "总计（线上）" }),
															onlineStats && onlineStats.available === true
																? jsxs(Fragment, {
																	children: [
																		jsx("div", {
																			className: "dsbc-stats-hint",
																			children: "账号全部用量（含非 DSH 调用），平台数据可能有延迟"
																		}),
																		jsxs("div", {
																			className: "dsbc-stats-row",
																			children: [
																				jsx("span", { children: "累计消费" }),
																				jsx("span", { className: "dsbc-stats-value", children: onlineStats.range === statsRange ? formatCost(onlineStats.cost, onlineCurrency) : "—" })
																			]
																		}),
																		jsxs("div", {
																			className: "dsbc-stats-row",
																			children: [
																				jsx("span", { children: "累计 Tokens" }),
																				jsx("span", { className: "dsbc-stats-value", children: onlineStats.range === statsRange ? formatTokens(onlineStats.totalTokens) : "—" })
																			]
																		}),
																		(statsRange === "7d" || statsRange === "30d") && onlineStats.range === statsRange && Array.isArray(onlineStats.daily) && onlineStats.daily.length > 0
																			? renderDailyChart(onlineStats.daily, statsRange, chartMetric, onlineCurrency, setChartMetric)
																			: null,
																		onlineStats.truncated === true
																			? jsx("div", {
																				className: "dsbc-stats-hint",
																				children: `较早月份未包含：仅回溯 ${onlineStats.monthCount} 个月`
																			})
																			: null
																	]
																})
																: jsx("div", {
																	className: "dsbc-stats-hint",
																	children: onlineLoading
																		? "线上统计中…"
																		: (onlineError !== ""
																			? onlineError
																			: (onlineStats && onlineStats.message ? onlineStats.message : "未配置平台 Token，总计不可用"))
																})
														]
													})
													: null,
												statsLoading
													? jsx("div", { className: "dsbc-stats-loading", children: "统计中…" })
													: null
											]
										}),
										jsx("div", {
											className: "dsbc-footer",
											children: [
												updatedAt
													? jsx("span", { className: "dsbc-updated", children: `更新于 ${formatTime(updatedAt)}` })
													: null,
												jsx("a", {
													className: "dsbc-recharge",
													href: "https://platform.deepseek.com/top_up",
													target: "_blank",
													rel: "noopener noreferrer",
													children: "充值 ↗"
												})
											]
										})
									]
								}),
						settingsOpen
							? jsxs("div", {
								className: "dsbc-settings",
								ref: settingsRef,
								children: [
									jsx("div", { className: "dsbc-settings-title", children: "DeepSeek API Key 设置" }),
									settingsInfo && settingsInfo.value && settingsInfo.value.credential
										? jsx("div", {
											className: "dsbc-settings-info",
											children: settingsInfo.value.credential.configured
												? "当前已配置手动 Key（存于 DSH 凭据系统）"
												: "当前未设置手动 Key"
										})
										: null,
									settingsInfo && settingsInfo.value && settingsInfo.value.harnessConfigured
										? jsx("div", {
											className: "dsbc-settings-info",
											children: "未设置手动 Key 时，自动使用 DSH 设置 → 模型 中的 DEEPSEEK_API_KEY。"
										})
										: null,
									jsx("input", {
										type: "password",
										value: apiKey,
										placeholder: "粘贴 DeepSeek API Key",
										onChange: (e) => setApiKey(e.target.value),
										onKeyDown: (e) => {
											if (e.key === "Enter") saveKey();
										}
									}),
									jsxs("div", {
										className: "dsbc-settings-actions",
										children: [
											jsx("button", {
												type: "button",
												disabled: saving || !apiKey.trim(),
												onClick: saveKey,
												children: saving ? "保存中…" : "保存"
											}),
											jsx("button", {
												type: "button",
												disabled: saving,
												onClick: clearKey,
												children: "清除"
											})
										]
									}),
									settingsMessage
										? jsx("div", {
											className: `dsbc-settings-msg dsbc-settings-msg-${settingsMessage.type}`,
											children: settingsMessage.text
										})
										: null,
									jsxs("div", {
										className: "dsbc-section",
										children: [
											jsx("div", { className: "dsbc-settings-title", children: "DeepSeek 平台 Token（线上统计）" }),
											settingsInfo && settingsInfo.value && settingsInfo.value.platform
												? jsx("div", {
													className: "dsbc-settings-info",
													children: settingsInfo.value.platform.configured
														? "已配置平台 Token（用于线上「总计」统计）"
														: "未配置平台 Token：线上「总计」不可用"
												})
												: null,
											jsx("input", {
												type: "password",
												value: platformToken,
												placeholder: "粘贴 platform.deepseek.com 的 userToken",
												onChange: (e) => setPlatformToken(e.target.value),
												onKeyDown: (e) => {
													if (e.key === "Enter") savePlatformToken();
												}
											}),
											jsxs("div", {
												className: "dsbc-settings-actions",
												children: [
													jsx("button", {
														type: "button",
														disabled: savingPlatform || !platformToken.trim(),
														onClick: savePlatformToken,
														children: savingPlatform ? "保存中…" : "保存"
													}),
													jsx("button", {
														type: "button",
														disabled: savingPlatform,
														onClick: clearPlatformToken,
														children: "清除"
													})
												]
											}),
											platformMessage
												? jsx("div", {
													className: `dsbc-settings-msg dsbc-settings-msg-${platformMessage.type}`,
													children: platformMessage.text
												})
												: null,
											jsx("div", {
												className: "dsbc-settings-info",
												children: "获取方式：登录 platform.deepseek.com 后按 F12 → 应用 → 本地存储 → platform.deepseek.com → userToken 的值。该 Token 仅用于查询官方用量接口（总计），与 API Key 相互独立。"
											})
										]
									}),
									jsxs("div", {
										className: "dsbc-section",
										children: [
											jsx("div", { className: "dsbc-settings-title", children: "统计显示" }),
											jsx("label", {
												className: "dsbc-check",
												children: [
													jsx("input", {
														type: "checkbox",
														checked: showTotal,
														onChange: (e) => setShowTotal(e.target.checked)
													}),
													jsx("span", { children: "显示总计（线上统计）" })
												]
											})
										]
									}),
									jsxs("div", {
										className: "dsbc-section",
										children: [
											jsx("div", { className: "dsbc-settings-title", children: "玻璃效果参数" }),
											jsx(GlassSlider, {
												label: "透明度",
												value: glass.alpha,
												min: 0,
												max: 80,
												step: 1,
												unit: "%",
												onChange: (v) => updateGlass("alpha", v)
											}),
											jsx(GlassSlider, {
												label: "背景模糊",
												value: glass.blur,
												min: 0,
												max: 40,
												step: 1,
												unit: "px",
												onChange: (v) => updateGlass("blur", v)
											}),
											jsx(GlassSlider, {
												label: "饱和度",
												value: glass.saturate,
												min: 100,
												max: 300,
												step: 10,
												unit: "%",
												onChange: (v) => updateGlass("saturate", v)
											}),
											jsx(GlassSlider, {
												label: "高光强度",
												value: Math.round(glass.highlight * 100),
												min: 0,
												max: 100,
												step: 5,
												unit: "%",
												onChange: (v) => updateGlass("highlight", v / 100)
											}),
											jsx(GlassSlider, {
												label: "流动光线",
												value: Math.round(glass.shine * 100),
												min: 0,
												max: 50,
												step: 5,
												unit: "%",
												onChange: (v) => updateGlass("shine", v / 100)
											}),
											jsx("button", {
												type: "button",
												className: "dsbc-settings-reset",
												onClick: resetGlass,
												children: "恢复默认"
											})
										]
									}),
									jsxs("div", {
										className: "dsbc-section",
										children: [
											jsx("div", { className: "dsbc-settings-title", children: "3D 立体效果" }),
											jsx("label", {
												className: "dsbc-check",
												children: [
													jsx("input", {
														type: "checkbox",
														checked: glass.enable3d,
														onChange: (e) => updateGlass("enable3d", e.target.checked)
													}),
													jsx("span", { children: "启用 3D 立体厚度" })
												]
											}),
											jsx(GlassSlider, {
												label: "立体厚度",
												value: glass.thickness,
												min: 0,
												max: 40,
												step: 1,
												unit: "px",
												disabled: !glass.enable3d,
												onChange: (v) => updateGlass("thickness", v)
											}),
											jsx(GlassSlider, {
												label: "侧向角度",
												value: glass.angle,
												min: -30,
												max: 30,
												step: 1,
												unit: "°",
												disabled: !glass.enable3d,
												onChange: (v) => updateGlass("angle", v)
											})
										]
									}),
									jsxs("div", {
										className: "dsbc-section",
										children: [
											jsx("div", { className: "dsbc-settings-title", children: "卡片尺寸" }),
											jsx(GlassSlider, {
												label: "卡片宽度",
												value: glass.cardWidth,
												min: 220,
												max: 420,
												step: 4,
												unit: "px",
												onChange: (v) => updateGlass("cardWidth", v)
											}),
											jsx(GlassSlider, {
												label: "最小高度",
												value: glass.cardHeight,
												min: 0,
												max: 400,
												step: 10,
												unit: "px",
												onChange: (v) => updateGlass("cardHeight", v)
											}),
											jsx("div", {
												className: "dsbc-settings-info",
												children: "最小高度为 0 时自动适应内容。"
											})
										]
									}),
									jsxs("div", {
										className: "dsbc-section",
										children: [
											jsx("div", { className: "dsbc-settings-title", children: "币种设置" }),
											jsx("label", {
												className: "dsbc-select-row",
												children: [
													jsx("span", { children: "余额币种" }),
													jsx("select", {
														value: glass.currency,
														onChange: (e) => updateGlass("currency", e.target.value),
														children: [
															jsx("option", { value: "CNY", children: "人民币 CNY（推荐）" }),
															jsx("option", { value: "USD", children: "美元 USD" }),
															jsx("option", { value: "auto", children: "自动（优先人民币）" })
														]
													})
												]
											}),
											jsx("div", {
												className: "dsbc-settings-info",
												children: "如果账号同时有人民币和美元余额，选择人民币可避免余额与消费金额币种冲突；选择美元时本地统计按 USD 显示（costUsd）。"
											})
										]
									}),
									jsxs("div", {
										className: "dsbc-section",
										children: [
											jsx("div", { className: "dsbc-settings-title", children: "颜色调节" }),
											jsx("label", {
												className: "dsbc-check",
												children: [
													jsx("input", {
														type: "checkbox",
														checked: glass.colorEnabled,
														onChange: (e) => updateGlass("colorEnabled", e.target.checked)
													}),
													jsx("span", { children: "自定义玻璃颜色（保持液态玻璃特性）" })
												]
											}),
											jsx("div", {
												className: "dsbc-color-row",
												children: [
													jsx("input", {
														type: "color",
														value: glass.color,
														disabled: !glass.colorEnabled,
														onChange: (e) => updateGlass("color", e.target.value)
													}),
													jsx("span", { children: glass.colorEnabled ? glass.color : "默认主题色" })
												]
											}),
											jsx(GlassSlider, {
												label: "颜色浓度",
												value: glass.colorStrength,
												min: 0,
												max: 100,
												step: 5,
												unit: "%",
												disabled: !glass.colorEnabled,
												onChange: (v) => updateGlass("colorStrength", v)
											})
										]
									})
								]
							})
							: null
								]
							})
						})
					]
				})
			});
		}

		// ---- official plugin-configuration card (Settings > Plugins > 插件配置) ----

		/** One call to the plugin's own settings route (official card wire protocol). */
		async function requestRoute(payload) {
			const init = payload === undefined ? {} : {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload)
			};
			const response = await fetch(SETTINGS_PATH, { credentials: "same-origin", ...init });
			const body = await response.json();
			if (!response.ok || !body.ok) {
				throw new Error(body && body.error && typeof body.error.message === "string" ? body.error.message : `request failed with HTTP ${response.status}`);
			}
			return body.value;
		}

		/** SettingsScope-compatible adapter over the plugin's own settings route. */
		function createRouteScope(route) {
			let snapshot = {
				status: "loading",
				writable: false,
				value: undefined,
				base: undefined,
				user: undefined,
				revision: undefined,
				mode: "host"
			};
			const listeners = new Set();
			function notify() {
				for (const listener of listeners) listener();
			}
			async function load() {
				try {
					const value = await route();
					snapshot = {
						status: "ready",
						writable: value?.writable === true,
						value: value?.settings?.value,
						base: value?.settings?.base,
						user: value?.settings?.user,
						revision: value?.settings?.revision,
						mode: "host"
					};
				} catch {
					snapshot = { status: "error", writable: false, value: undefined, base: undefined, user: undefined, revision: undefined, mode: "host" };
				}
				notify();
			}
			async function mutate(ops) {
				const revision = snapshot.revision;
				const value = await route({
					action: "mutate",
					ops,
					...(revision === undefined ? {} : { expectedRevision: revision })
				});
				snapshot = {
					status: "ready",
					writable: value?.writable === true,
					value: value?.settings?.value,
					base: value?.settings?.base,
					user: value?.settings?.user,
					revision: value?.settings?.revision,
					mode: "host"
				};
				notify();
			}
			return {
				getSnapshot: () => snapshot,
				subscribe: (listener) => {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
				set: (field, value) => mutate([{ op: "set", path: [field], value }]),
				unset: (field) => mutate([{ op: "unset", path: [field] }]),
				load
			};
		}

		/* Official plugin-card chrome + staged-field styles (same tokens/values as the
		 * shipped dsh-client-ui-settings-plugins cards; prefixed to stay collision-free). */
		const CARD_CSS = ".pcc-field{flex-direction:column;gap:6px;padding:12px 0;display:flex}" +
			".pcc-field+.pcc-field{border-top:1px solid var(--dsw-alias-border-l2)}" +
			".pcc-head{align-items:center;gap:8px;display:flex}" +
			".pcc-label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}" +
			".pcc-badges{align-items:center;gap:8px;display:inline-flex}" +
			".pcc-badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}" +
			".pcc-badgeMuted{white-space:nowrap;color:var(--dsw-alias-label-tertiary);border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px}" +
			".pcc-reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:1.5}" +
			".pcc-reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}" +
			".pcc-reset:disabled{cursor:default}" +
			".pcc-input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5}" +
			".pcc-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}" +
			".pcc-input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}" +
			".pcc-inputInvalid{border-color:var(--dsw-alias-label-error)}" +
			".pcc-invalid{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}" +
			".pcc-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}" +
			".pcc-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}" +
			".pcc-card:hover{border-color:var(--dsw-alias-label-dimmed)}" +
			".pcc-cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}" +
			".pcc-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}" +
			".pcc-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}" +
			".pcc-headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}" +
			".pcc-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}" +
			".pcc-description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}" +
			".pcc-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}" +
			".pcc-chevronOpen{transform:rotate(180deg)}" +
			".pcc-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}" +
			".pcc-readOnly{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}" +
			".pcc-pending{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}" +
			".pcc-footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}" +
			".pcc-failed{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}" +
			".pcc-discard,.pcc-save{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}" +
			".pcc-discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}" +
			".pcc-discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}" +
			".pcc-save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}" +
			".pcc-discard:disabled,.pcc-save:disabled{opacity:.4;cursor:default}" +
			".pcc-discard:focus-visible,.pcc-save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}";

		function installCardStyles() {
			const style = document.createElement("style");
			style.dataset.pluginCss = "dsh-liquid-glass-balance-card";
			style.textContent = CARD_CSS;
			document.head.appendChild(style);
			return () => {
				style.remove();
			};
		}

		/* ---- staged-field specs (official card-form semantics) ---- */

		/** A free-text field: an empty draft clears the field. */
		function textField(field) {
			return {
				field,
				format: (value) => typeof value === "string" ? value : "",
				parse: (text) => {
					const trimmed = text.trim();
					return trimmed === "" ? { kind: "clear" } : { kind: "set", value: trimmed };
				}
			};
		}

		/** A numeric field: a non-finite draft is invalid. */
		function numberField(field) {
			return {
				field,
				format: (value) => typeof value === "number" ? String(value) : "",
				parse: (text) => {
					const n = Number(text);
					if (!Number.isFinite(n)) return undefined;
					return { kind: "set", value: n };
				}
			};
		}

		/* ---- staged form model (mirror of the official CardForm) ---- */

		function createForm(scope, specs, secrets) {
			const specMap = new Map(specs.map((spec) => [spec.field, spec]));
			const secretMap = new Map(secrets.map((spec) => [spec.field, spec]));
			const staged = new Map();
			const listeners = new Set();
			let saving = false;
			let failed = false;

			const snapshotOf = () => scope.getSnapshot();
			const sectionValue = (field) => snapshotOf().value?.[field];
			const baseValue = (field) => snapshotOf().base?.[field];
			const userLayer = () => snapshotOf().user;
			const stored = (field) => {
				const user = userLayer();
				return user !== undefined && Object.hasOwn(user, field);
			};
			const specOf = (field) => {
				const spec = specMap.get(field);
				if (spec === undefined) throw new Error("plugin card has no field " + field);
				return spec;
			};

			function publish() {
				for (const listener of listeners) listener();
			}

			function plan() {
				const plan = [];
				for (const [field, edit] of staged) {
					const secret = secretMap.get(field);
					if (secret !== undefined) {
						const value = edit.text.trim();
						if (value !== "") plan.push({ field, run: () => secret.write(value) });
						continue;
					}
					const spec = specOf(field);
					if (edit.clear) {
						if (stored(field)) plan.push({ field, run: () => clearField(field) });
						continue;
					}
					if (edit.text === spec.format(sectionValue(field))) continue;
					const write = spec.parse(edit.text);
					if (write === undefined) plan.push({ field, run: undefined });
					else if (write.kind === "clear") plan.push({ field, run: () => clearField(field) });
					else plan.push({ field, run: () => storeField(field, write.value) });
				}
				return plan;
			}

			function shell() {
				const snapshot = snapshotOf();
				const planned = plan();
				return {
					available: snapshot.status === "ready",
					writable: snapshot.writable,
					dirty: planned.length > 0,
					invalid: planned.some((item) => item.run === undefined),
					saving,
					failed
				};
			}

			function field(field) {
				const edit = staged.get(field);
				if (secretMap.has(field)) {
					return { text: edit?.text ?? "", overridden: false, invalid: false };
				}
				const spec = specOf(field);
				if (edit === undefined) {
					return { text: spec.format(sectionValue(field)), overridden: stored(field), invalid: false };
				}
				const write = edit.clear ? { kind: "clear" } : spec.parse(edit.text);
				return {
					text: edit.text,
					overridden: write?.kind === "set",
					invalid: write === undefined
				};
			}

			function stage(field, edit) {
				staged.set(field, edit);
				failed = false;
				publish();
			}

			async function clearField(field) {
				await scope.unset(field);
				return !stored(field);
			}

			async function storeField(field, value) {
				await scope.set(field, value);
				return userLayer()?.[field] === value;
			}

			async function save() {
				const planned = plan();
				const writes = planned.flatMap((item) => item.run === undefined ? [] : [item.run]);
				if (planned.length === 0 || saving || writes.length !== planned.length) return;
				saving = true;
				failed = false;
				publish();
				let landed = true;
				for (const write of writes) landed = await write() && landed;
				if (landed) staged.clear();
				saving = false;
				failed = !landed;
				publish();
			}

			scope.subscribe(() => publish());

			return {
				shell,
				field,
				actions: () => ({
					edit: (field, text) => stage(field, { text, clear: false }),
					resetField: (field) => stage(field, { text: specOf(field).format(baseValue(field)), clear: true }),
					save,
					discard: () => {
						if (staged.size === 0 && !failed) return;
						staged.clear();
						failed = false;
						publish();
					}
				}),
				subscribe: (listener) => {
					listeners.add(listener);
					return () => listeners.delete(listener);
				}
			};
		}

		/* ---- official card chrome ---- */

		function ChevronDown(props) {
			return React.createElement("svg", {
				width: 14,
				height: 14,
				className: props.className,
				viewBox: "0 0 14 14",
				fill: "none",
				xmlns: "http://www.w3.org/2000/svg",
				"aria-hidden": true
			}, React.createElement("path", {
				d: "M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z",
				fill: "currentColor"
			}));
		}

		function PluginCard(props) {
			const [open, setOpen] = React.useState(false);
			const { state } = props;
			if (!state.available) return null;
			const blocked = !state.dirty || state.invalid || state.saving;
			return React.createElement("li", { className: "pcc-card" + (open ? " pcc-cardOpen" : "") },
				React.createElement("button", {
					type: "button",
					className: "pcc-header",
					"aria-expanded": open,
					"aria-label": (open ? "收起设置" : "展开设置") + "：" + props.title,
					onClick: () => setOpen(!open)
				},
					React.createElement("span", { className: "pcc-headText" },
						React.createElement("span", { className: "pcc-name" }, props.title),
						React.createElement("span", { className: "pcc-description" }, props.description)),
					state.dirty ? React.createElement("span", { className: "pcc-pending" }, "未保存") : null,
					React.createElement(ChevronDown, { className: "pcc-chevron" + (open ? " pcc-chevronOpen" : "") })),
				open ? React.createElement("div", { className: "pcc-body" },
					!state.writable ? React.createElement("p", { className: "pcc-readOnly", role: "status" }, "本部署的设置为只读。") : null,
					props.children,
					React.createElement("div", { className: "pcc-footer" },
						state.failed ? React.createElement("p", { className: "pcc-failed", role: "status" }, "本部署没有接受这些值，已保留供你修改。") : null,
						React.createElement("button", { type: "button", className: "pcc-discard", disabled: !state.dirty || state.saving, onClick: props.onDiscard }, "放弃修改"),
						React.createElement("button", { type: "button", className: "pcc-save", disabled: blocked, onClick: props.onSave }, state.saving ? "保存中…" : "保存"))) : null);
		}

		function ValueField(props) {
			return React.createElement("div", { className: "pcc-field" },
				React.createElement("div", { className: "pcc-head" },
					React.createElement("label", { className: "pcc-label", htmlFor: props.id }, props.label),
					props.overridden ? React.createElement("span", { className: "pcc-badges" },
						React.createElement("span", { className: "pcc-badge" }, props.overriddenLabel),
						React.createElement("button", { type: "button", className: "pcc-reset", disabled: props.disabled, onClick: props.onReset }, props.resetLabel)) : null),
				React.createElement("input", {
					id: props.id,
					className: props.invalid ? "pcc-input pcc-inputInvalid" : "pcc-input",
					type: "text",
					...(props.numeric === true ? { inputMode: "numeric" } : {}),
					...(props.invalid ? { "aria-invalid": true } : {}),
					value: props.text,
					placeholder: props.placeholder ?? "",
					disabled: props.disabled,
					onChange: (event) => props.onEdit(event.target.value)
				}),
				React.createElement("p", { className: props.invalid ? "pcc-invalid" : "pcc-hint" },
					props.invalid ? props.invalidLabel : props.hint));
		}

		/** A write-only credential control: never echoes the value, blank draft writes nothing. */
		function SecretField(props) {
			return React.createElement("div", { className: "pcc-field" },
				React.createElement("div", { className: "pcc-head" },
					React.createElement("label", { className: "pcc-label", htmlFor: props.id }, props.label),
					React.createElement("span", { className: "pcc-badges" },
						React.createElement("span", { className: props.configured ? "pcc-badge" : "pcc-badgeMuted" }, props.stateLabel))),
				React.createElement("input", {
					id: props.id,
					className: "pcc-input",
					type: "password",
					autoComplete: "off",
					value: props.text,
					disabled: props.disabled,
					onChange: (event) => props.onEdit(event.target.value)
				}),
				React.createElement("p", { className: "pcc-hint" }, props.hint));
		}

		/* ---- card controller over the balance-card settings route + credentials domain ---- */

		const CREDENTIAL_REF_NAME = "DSH_LIQUID_GLASS_API_KEY";
		const PLATFORM_CREDENTIAL_REF_NAME = "DSH_LIQUID_GLASS_PLATFORM_TOKEN";

		function BalanceCardController(ctx) {
			const scope = createRouteScope((payload) => requestRoute(payload));
			const api = ctx.get("connection")?.api;
			const credential = { ref: CREDENTIAL_REF_NAME, configured: false, writable: true };
			const platformCredential = { ref: PLATFORM_CREDENTIAL_REF_NAME, configured: false, writable: true };
			const form = createForm(scope, [
				numberField("refreshSeconds"),
				numberField("onlineRefreshSeconds")
			], [
				{ field: "token", write: (text) => writeToken(text) },
				{ field: "platformToken", write: (text) => writePlatformToken(text) }
			]);
			const actions = form.actions();
			const listeners = new Set();
			let state = null;

			function publish() {
				state = project();
				for (const listener of listeners) listener();
			}

			function project() {
				return {
					...form.shell(),
					refreshSeconds: form.field("refreshSeconds"),
					onlineRefreshSeconds: form.field("onlineRefreshSeconds"),
					token: form.field("token"),
					tokenConfigured: credential.configured,
					tokenWritable: credential.writable,
					platformToken: form.field("platformToken"),
					platformTokenConfigured: platformCredential.configured,
					platformTokenWritable: platformCredential.writable
				};
			}

			/** Ask the credentials domain whether the Host holds either secret. */
			async function readCredential() {
				if (api === undefined) return;
				let response;
				try {
					response = await api.credentials.describe({ refs: [credential.ref, platformCredential.ref] });
				} catch {
					return;
				}
				if (!response?.result?.ok) return;
				const views = response.result.value?.credentials ?? {};
				const tokenView = views[credential.ref];
				const platformView = views[platformCredential.ref];
				const nextToken = { configured: tokenView?.configured ?? false, writable: tokenView?.writable ?? true };
				const nextPlatform = { configured: platformView?.configured ?? false, writable: platformView?.writable ?? true };
				const tokenChanged = nextToken.configured !== credential.configured || nextToken.writable !== credential.writable;
				const platformChanged = nextPlatform.configured !== platformCredential.configured || nextPlatform.writable !== platformCredential.writable;
				if (!tokenChanged && !platformChanged) return;
				credential.configured = nextToken.configured;
				credential.writable = nextToken.writable;
				platformCredential.configured = nextPlatform.configured;
				platformCredential.writable = nextPlatform.writable;
				publish();
			}

			/** Write the staged key, then re-read whether the Host now holds one. */
			async function writeToken(value) {
				if (api === undefined) return false;
				try {
					await api.credentials.set({ ref: credential.ref, value });
				} catch {
					// fall through: read back what the Host actually holds
				}
				await readCredential();
				return credential.configured;
			}

			/** Unset the manual key through the credentials domain. */
			async function clearToken() {
				if (api === undefined) return false;
				try {
					await api.credentials.unset({ ref: credential.ref });
				} catch {
					// fall through: read back what the Host actually holds
				}
				await readCredential();
				return !credential.configured;
			}

			/** Write the staged platform token, then re-read whether the Host now holds one. */
			async function writePlatformToken(value) {
				if (api === undefined) return false;
				try {
					await api.credentials.set({ ref: platformCredential.ref, value });
				} catch {
					// fall through: read back what the Host actually holds
				}
				await readCredential();
				return platformCredential.configured;
			}

			/** Unset the platform token through the credentials domain. */
			async function clearPlatformToken() {
				if (api === undefined) return false;
				try {
					await api.credentials.unset({ ref: platformCredential.ref });
				} catch {
					// fall through: read back what the Host actually holds
				}
				await readCredential();
				return !platformCredential.configured;
			}

			form.subscribe(publish);
			scope.subscribe(() => {
				void readCredential();
			});
			publish();
			void scope.load();
			void readCredential();

			return {
				subscribe: (listener) => {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
				snapshot: () => state,
				credentialRef: () => credential.ref,
				platformCredentialRef: () => platformCredential.ref,
				refresh: () => {
					void scope.load();
				},
				refreshCredential: () => {
					void readCredential();
				},
				writeToken,
				clearToken,
				writePlatformToken,
				clearPlatformToken,
				edit: actions.edit,
				resetField: actions.resetField,
				save: actions.save,
				discard: actions.discard
			};
		}

		function BalanceCard(props) {
			const controller = props.controller;
			const state = React.useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
			const disabled = !state.writable;
			const field = (key, label, hint, extra = {}) => React.createElement(ValueField, {
				id: "plugin-config-balance-" + key,
				label,
				hint,
				overriddenLabel: "已覆盖",
				resetLabel: "恢复默认",
				invalidLabel: "请输入有效值，或留空使用默认值。",
				disabled,
				...state[key],
				onEdit: (text) => controller.edit(key, text),
				onReset: () => controller.resetField(key),
				...extra
			});
			return React.createElement(PluginCard, {
				title: "DeepSeek 余额卡片",
				description: "配置 API Key、平台 Token（线上总计）与余额自动刷新间隔。",
				state,
				onSave: controller.save,
				onDiscard: controller.discard
			},
				React.createElement(SecretField, {
					id: "plugin-config-balance-token",
					label: "DeepSeek API Key",
					hint: "存于 DSH 凭据系统（不写入设置文件）；留空表示保持当前密钥。",
					disabled: !state.tokenWritable,
					text: state.token.text,
					configured: state.tokenConfigured,
					stateLabel: state.tokenConfigured ? "已配置密钥。" : "未配置密钥。",
					onEdit: (text) => controller.edit("token", text)
				}),
				React.createElement(SecretField, {
					id: "plugin-config-balance-platform-token",
					label: "DeepSeek 平台 Token (userToken)",
					hint: "用于线上「总计」统计（platform.deepseek.com 控制台 userToken，非 API Key；API Key 无法读取官方用量接口）。获取方式：登录 platform.deepseek.com 后 F12 → 应用 → 本地存储 → userToken。",
					disabled: !state.platformTokenWritable,
					text: state.platformToken.text,
					configured: state.platformTokenConfigured,
					stateLabel: state.platformTokenConfigured ? "已配置平台 Token。" : "未配置平台 Token。",
					onEdit: (text) => controller.edit("platformToken", text)
				}),
				field("refreshSeconds", "刷新间隔 (refreshSeconds)", "余额自动刷新的秒数（30–600）。", { numeric: true, placeholder: "60" }),
				field("onlineRefreshSeconds", "线上刷新间隔 (onlineRefreshSeconds)", "线上「总计」自动刷新的秒数（60–3600）。平台数据有延迟，建议 300 以上。", { numeric: true, placeholder: "300" }));
		}

		// ---- client plugin body -----------------------------------------
		const inject = ["slots", "connection"];

		function apply(ctx) {
			const styleEl = injectStyles();
			const cardStyleDispose = installCardStyles();
			const controller = new BalanceCardController(ctx);
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "liquid-glass-balance-card",
				order: 100,
				label: "DeepSeek 余额卡片",
				inject: () => ({ controller })
			}, DeepSeekBalanceCard));
			ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
				name: "settings.plugin.item",
				key: "liquid-glass-balance-card",
				id: "liquid-glass-balance-card",
				order: 30,
				inject: () => ({ controller })
			}, BalanceCard));
			const remote = ctx.get("remote");
			if (remote !== undefined && typeof remote.$on === "function") {
				ctx.effect(() => remote.$on("settings/document-updated", (namespace) => {
					if (namespace === undefined || String(namespace) === "liquid-glass-balance-card") controller.refresh();
				}), "dsh-liquid-glass-balance-card: settings invalidations");
				ctx.effect(() => remote.$on("credentials/updated", (ref) => {
					const refStr = String(ref);
					if (refStr === controller.credentialRef() || refStr === controller.platformCredentialRef()) controller.refreshCredential();
				}), "dsh-liquid-glass-balance-card: credential invalidations");
			}
			ctx.effect(() => () => {
				if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
				cardStyleDispose();
			}, "dsh-liquid-glass-balance-card: styles");
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
