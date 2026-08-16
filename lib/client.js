// dsh-deepseek-balance-card — browser half.
//
// A draggable liquid-glass floating card pinned to the top-right corner of the
// DSH web GUI (registered into the frame-wide `shell.overlay` slot). It polls
// the host route `/api/deepseek-balance-card/balance`, supports a manual API
// key in its settings popover, and remembers its dragged position in
// localStorage.
//
// The bundle is a CJS closure-factory consumed by DSH's client module loader.
window.__ModuleLoader__.load({
	id: "dsh-deepseek-balance-card",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let jsxRuntime = require("react/jsx-runtime");
		const { useState, useEffect, useCallback, useRef } = react;
		const { jsx, jsxs, Fragment } = jsxRuntime;

		// ---- constants -------------------------------------------------
		const POLL_MS = 60 * 1000;
		const SETTINGS_PATH = "/api/deepseek-balance-card/settings";
		const BALANCE_PATH = "/api/deepseek-balance-card/balance";
		const STATS_PATH = "/api/deepseek-balance-card/stats";
		const RANGE_LABELS = { today: "今天", yesterday: "昨天", "7d": "近7天", "30d": "近30天", all: "全部" };
		const POSITION_KEY = "dsh-deepseek-balance-card-pos";
		const GLASS_KEY = "dsh-deepseek-balance-card-glass";
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
			color: "#4f8cff"
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
							}
						}
						out.alpha = clamp(out.alpha, 0, 80);
						out.blur = clamp(out.blur, 0, 40);
						out.saturate = clamp(out.saturate, 100, 300);
						out.highlight = clamp(out.highlight, 0, 1);
						out.shine = clamp(out.shine, 0, 0.5);
						out.thickness = clamp(out.thickness, 0, 40);
						out.angle = clamp(out.angle, -30, 30);
						return out;
					}
				}
			} catch {}
			return { ...DEFAULT_GLASS };
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
					--dsbc-thickness: 0px;
					--dsbc-angle: 0deg;
					position: fixed;
					z-index: 9999;
					box-sizing: border-box;
					width: 264px;
					border-radius: 20px;
					padding: 14px 16px 12px;
					font-size: 12px;
					line-height: 18px;
					color: var(--dsw-alias-label-primary, #1f2328);
					background: var(--dsw-alias-bg-overlay, rgba(255, 255, 255, 0.65));
					border: 1px solid rgba(255, 255, 255, 0.45);
					box-shadow:
						calc(var(--dsbc-thickness, 0px) * 0.35) calc(var(--dsbc-thickness, 0px) * 0.35) 0 rgba(0, 0, 0, 0.16),
						calc(var(--dsbc-thickness, 0px) * 0.7) calc(var(--dsbc-thickness, 0px) * 0.7) 0 rgba(0, 0, 0, 0.1),
						inset 0 1px 0 rgba(255, 255, 255, 0.45),
						inset 0 -1px 0 rgba(255, 255, 255, 0.06),
						inset 0 0 0 1px rgba(255, 255, 255, 0.08),
						0 8px 32px rgba(0, 0, 0, 0.18);
					user-select: none;
					-webkit-user-select: none;
					font-family: inherit;
					overflow: hidden;
					transform-style: preserve-3d;
					will-change: transform;
					transition: box-shadow 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
				}
				.dsbc-card::before {
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
				.dsbc-card::after {
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
				.dsbc-card > * {
					position: relative;
					z-index: 1;
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
					.dsbc-card {
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
					.dsbc-card::after {
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
					background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
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
					border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));
					background: var(--dsw-alias-bg-field, #ffffff);
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
					border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));
					background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
					color: var(--dsw-alias-label-primary, #1f2328);
					cursor: pointer;
					font-size: 11px;
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
				.dsbc-slider input[type="range"] {
					box-sizing: border-box;
					width: 100%;
					height: 18px;
					margin: 0;
					padding: 0;
					accent-color: #4f8cff;
					background: transparent;
				}
				.dsbc-settings-reset {
					align-self: flex-start;
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
					border: 0;
					border-radius: 999px;
					padding: 1px 8px;
					font-size: 10px;
					line-height: 16px;
					cursor: pointer;
					color: var(--dsw-alias-label-secondary, #57606a);
					background: transparent;
				}
				.dsbc-range-tabs button:hover {
					background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
				}
				.dsbc-range-tabs button.active {
					color: #fff;
					background: #4f8cff;
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
		function DeepSeekBalanceCard() {
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
			const [pos, setPos] = useState(loadPosition);
			const [glass, setGlass] = useState(loadGlass);
			const [stats, setStats] = useState(null);
			const [statsRange, setStatsRange] = useState("today");
			const [statsLoading, setStatsLoading] = useState(false);
			const posRef = useRef(pos);
			const drag = useRef(null);
			const cardRef = useRef(null);

			useEffect(() => {
				posRef.current = pos;
			}, [pos]);

			useEffect(() => {
				try {
					localStorage.setItem(GLASS_KEY, JSON.stringify(glass));
				} catch {}
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
				load();
				const timer = setInterval(load, POLL_MS);
				return () => clearInterval(timer);
			}, [load]);

			const loadStats = useCallback(async (range) => {
				const key = range || "today";
				setStatsLoading(true);
				try {
					const res = await fetch(`${STATS_PATH}?range=${encodeURIComponent(key)}`, { cache: "no-store" });
					const body = await res.json().catch(() => null);
					if (body && body.ok === true) setStats(body);
				} catch {}
				finally {
					setStatsLoading(false);
				}
			}, []);

			useEffect(() => {
				loadStats(statsRange);
			}, [statsRange, loadStats]);

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
				if (!key) return;
				setSaving(true);
				setSettingsMessage(null);
				try {
					const res = await fetch(SETTINGS_PATH, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ apiKey: key })
					});
					const body = await res.json().catch(() => null);
					if (!res.ok || !body || body.ok !== true) {
						throw new Error(body && typeof body.message === "string" ? body.message : "保存失败");
					}
					setSettingsMessage({ type: "ok", text: "已保存手动 Key" });
					setApiKey("");
					await refreshSettings();
					load();
				} catch (error) {
					setSettingsMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
				} finally {
					setSaving(false);
				}
			}, [apiKey, load, refreshSettings]);

			const clearKey = useCallback(async () => {
				setSaving(true);
				setSettingsMessage(null);
				try {
					const res = await fetch(SETTINGS_PATH, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ clear: true })
					});
					const body = await res.json().catch(() => null);
					if (!res.ok || !body || body.ok !== true) {
						throw new Error(body && typeof body.message === "string" ? body.message : "清除失败");
					}
					setSettingsMessage({ type: "ok", text: "已清除手动 Key" });
					setApiKey("");
					await refreshSettings();
					load();
				} catch (error) {
					setSettingsMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
				} finally {
					setSaving(false);
				}
			}, [load, refreshSettings]);

			const updateGlass = useCallback((key, value) => {
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
				const height = cardRef.current ? cardRef.current.offsetHeight : CARD_HEIGHT;
				const x = clamp(d.left + e.clientX - d.startX, 0, Math.max(0, window.innerWidth - CARD_WIDTH));
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

			const payload = data && data.balance ? data.balance : null;
			const balance = payload && Array.isArray(payload.balance_infos) ? payload.balance_infos[0] : null;
			const available = payload ? payload.is_available !== false : null;
			const currency = balance && balance.currency ? balance.currency : "CNY";
			const sourceLabel = data && data.source === "harness" ? "DSH Key" : data && data.source === "manual" ? "手动 Key" : "";

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

			const glassStyle = {
				"--dsbc-alpha": `${glass.alpha}%`,
				"--dsbc-alpha2": `${Math.max(0, Math.round(glass.alpha / 2))}%`,
				"--dsbc-blur": `${glass.blur}px`,
				"--dsbc-saturate": `${glass.saturate}%`,
				"--dsbc-highlight": String(glass.highlight),
				"--dsbc-highlight-weak": String(Math.max(0, glass.highlight * 0.2)),
				"--dsbc-shine": String(glass.shine),
				"--dsbc-tint": glass.colorEnabled ? glass.color : "var(--dsw-alias-bg-overlay, #ffffff)",
				"--dsbc-thickness": `${glass.enable3d ? glass.thickness : 0}px`,
				"--dsbc-angle": `${glass.enable3d ? glass.angle : 0}deg`
			};
			const cardStyle = {
				...glassStyle,
				...(glass.enable3d
					? {
						transform: `perspective(900px) rotateY(${glass.angle}deg)`,
						transformStyle: "preserve-3d"
					}
					: {}),
				...(pos ? { left: pos.x, top: pos.y } : { top: 16, right: 16 })
			};

			return jsx("div", {
				className: "dsbc-card",
				ref: cardRef,
				role: "status",
				"aria-live": "polite",
				"data-plugin": "dsh-deepseek-balance-card",
				style: cardStyle,
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
								jsx("span", { className: "dsbc-title", children: "DeepSeek 余额" }),
								jsx("button", {
									type: "button",
									className: "dsbc-icon-btn",
									"aria-label": "刷新余额与统计",
									title: "刷新",
									disabled: spinning,
									onClick: () => { load(); loadStats(statsRange); },
									children: refreshIcon
								}),
								jsx("button", {
									type: "button",
									className: "dsbc-icon-btn",
									"aria-label": "卡片设置",
									title: "卡片设置",
									onClick: () => settingsOpen ? setSettingsOpen(false) : openSettings(),
									children: gearIcon
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
													className: "dsbc-stats-row",
													children: [
														jsx("span", { children: "累计消费" }),
														jsx("span", { className: "dsbc-stats-value", children: stats ? formatCost(stats.cost, currency) : "—" })
													]
												}),
												jsxs("div", {
													className: "dsbc-stats-row",
													children: [
														jsx("span", { children: "累计 Tokens" }),
														jsx("span", { className: "dsbc-stats-value", children: stats ? formatTokens(stats.totalTokens) : "—" })
													]
												}),
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
								children: [
									jsx("div", { className: "dsbc-settings-title", children: "DeepSeek API Key 设置" }),
									settingsInfo
										? jsx("div", {
											className: "dsbc-settings-info",
											children: settingsInfo.manualConfigured
												? `当前手动 Key：${settingsInfo.maskedKey || "已设置"}`
												: "当前未设置手动 Key"
										})
										: null,
									settingsInfo && settingsInfo.harnessConfigured
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
											})
										]
									})
								]
							})
							: null
					]
				})
			});
		}

		// ---- client plugin body -----------------------------------------
		const inject = ["slots"];

		function apply(ctx) {
			const styleEl = injectStyles();
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "deepseek-balance-card",
				order: 100,
				label: "DeepSeek 余额卡片"
			}, DeepSeekBalanceCard));
			ctx.effect(() => () => {
				if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
			}, "dsh-deepseek-balance-card: styles");
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
