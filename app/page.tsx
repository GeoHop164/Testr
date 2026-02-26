"use client";

import {
  ChangeEvent,
  PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const HISTORY_STORAGE_KEY = "qa-swipe-report-history-v1";
const INSTALL_PROMPT_DISMISS_KEY = "qa-swipe-install-dismiss-v1";
const SWIPE_THRESHOLD = 120;
const MAX_HISTORY_ITEMS = 50;

const SAMPLE_PLAN = `{
  "Category 1": [
    {
      "action": "click the log in button",
      "result": "user is logged in"
    },
    {
      "action": "click the log out button",
      "result": "user is logged out"
    }
  ],
  "Category 2": [
    {
      "action": "click the log in button",
      "result": "user is logged in"
    },
    {
      "action": "click the log out button",
      "result": "user is logged out"
    }
  ]
}`;

type Step = "start" | "input" | "run" | "report";
type Verdict = "pass" | "fail";

type PlanGroup = {
	action: string;
	result: string;
};

type PlanInput = Record<string, PlanGroup[]>;

type FlatTest = {
	id: string;
	category: string;
	action: string;
	expected: string;
	sequence: number;
};

type TestResult = FlatTest & {
	verdict: Verdict;
	comment: string;
};

type CategorySummary = Record<
	string,
	{
		passed: number;
		failed: number;
		total: number;
	}
>;

type SavedReport = {
	id: string;
	suiteName: string;
	createdAt: string;
	total: number;
	passed: number;
	failed: number;
	byCategory: CategorySummary;
	results: TestResult[];
	source: PlanInput;
};

interface BeforeInstallPromptEvent extends Event {
	prompt: () => Promise<void>;
	userChoice: Promise<{
		outcome: "accepted" | "dismissed";
		platform: string;
	}>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toSafeId() {
	if (
		typeof crypto !== "undefined" &&
		typeof crypto.randomUUID === "function"
	) {
		return crypto.randomUUID();
	}

	return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function slugify(value: string) {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)+/g, "");
}

function parsePlan(rawText: string): {
	source: PlanInput;
	flattened: FlatTest[];
} {
	let parsed: unknown;

	try {
		parsed = JSON.parse(rawText);
	} catch {
		throw new Error("Invalid JSON. Check commas, quotes, and brackets.");
	}

	if (!isRecord(parsed)) {
		throw new Error("The root value must be an object of categories.");
	}

	const source: PlanInput = {};
	const flattened: FlatTest[] = [];
	let sequence = 1;

	for (const [rawCategory, rawTests] of Object.entries(parsed)) {
		const category = rawCategory.trim();

		if (!category) {
			throw new Error("Category names cannot be empty.");
		}

		if (!Array.isArray(rawTests)) {
			throw new Error(`Category \"${category}\" must contain an array.`);
		}

		source[category] = [];

		rawTests.forEach((test, index) => {
			if (!isRecord(test)) {
				throw new Error(
					`\"${category}\" test #${index + 1} must be an object.`,
				);
			}

			const action =
				typeof test.action === "string" ? test.action.trim() : "";
			const result =
				typeof test.result === "string" ? test.result.trim() : "";

			if (!action || !result) {
				throw new Error(
					`\"${category}\" test #${index + 1} needs non-empty action/result.`,
				);
			}

			source[category].push({ action, result });
			flattened.push({
				id: `${category}-${index}-${sequence}`,
				category,
				action,
				expected: result,
				sequence,
			});
			sequence += 1;
		});
	}

	if (flattened.length === 0) {
		throw new Error("No tests were found in the plan.");
	}

	return { source, flattened };
}

function getCategorySummary(results: TestResult[]): CategorySummary {
	const summary: CategorySummary = {};

	results.forEach((result) => {
		if (!summary[result.category]) {
			summary[result.category] = { passed: 0, failed: 0, total: 0 };
		}

		summary[result.category].total += 1;
		if (result.verdict === "pass") {
			summary[result.category].passed += 1;
		} else {
			summary[result.category].failed += 1;
		}
	});

	return summary;
}

function buildReport(
	suiteName: string,
	source: PlanInput,
	results: TestResult[],
): SavedReport {
	const passed = results.filter((result) => result.verdict === "pass").length;
	const failed = results.length - passed;

	return {
		id: toSafeId(),
		suiteName,
		createdAt: new Date().toISOString(),
		total: results.length,
		passed,
		failed,
		byCategory: getCategorySummary(results),
		results,
		source,
	};
}

function formatDate(value: string) {
	return new Intl.DateTimeFormat("en-US", {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(value));
}

function saveFile(filename: string, body: string) {
	const blob = new Blob([body], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");

	link.href = url;
	link.download = filename;
	link.click();
	URL.revokeObjectURL(url);
}

export default function Home() {
	const [step, setStep] = useState<Step>("start");
	const [suiteName, setSuiteName] = useState("Regression Plan");
	const [jsonDraft, setJsonDraft] = useState(SAMPLE_PLAN);
	const [parseError, setParseError] = useState<string | null>(null);

	const [sourcePlan, setSourcePlan] = useState<PlanInput | null>(null);
	const [tests, setTests] = useState<FlatTest[]>([]);
	const [cursor, setCursor] = useState(0);
	const [results, setResults] = useState<Array<TestResult | null>>([]);
	const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>(
		{},
	);

	const [dragOffset, setDragOffset] = useState(0);
	const [isDragging, setIsDragging] = useState(false);
	const [exitVerdict, setExitVerdict] = useState<Verdict | null>(null);
	const pointerRef = useRef<{
		pointerId: number;
		startX: number;
		startY: number;
		locked: boolean;
	} | null>(null);
	const swipeTimeoutRef = useRef<number | null>(null);

	const [history, setHistory] = useState<SavedReport[]>([]);
	const [activeReportId, setActiveReportId] = useState<string | null>(null);
	const [showRawJson, setShowRawJson] = useState(false);
	const [deferredInstallPrompt, setDeferredInstallPrompt] =
		useState<BeforeInstallPromptEvent | null>(null);
	const [installDismissed, setInstallDismissed] = useState(false);
	const [isInstalled, setIsInstalled] = useState(false);
	const [isInstalling, setIsInstalling] = useState(false);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
		if (!raw) {
			return;
		}

		try {
			const parsed = JSON.parse(raw) as SavedReport[];
			if (Array.isArray(parsed)) {
				setHistory(parsed);
				setActiveReportId(parsed[0]?.id ?? null);
			}
		} catch {
			window.localStorage.removeItem(HISTORY_STORAGE_KEY);
		}

		const dismissed = window.localStorage.getItem(
			INSTALL_PROMPT_DISMISS_KEY,
		);
		if (dismissed === "1") {
			setInstallDismissed(true);
		}

		const isStandalone =
			window.matchMedia("(display-mode: standalone)").matches ||
			Boolean(
				(
					window.navigator as Navigator & {
						standalone?: boolean;
					}
				).standalone,
			);
		if (isStandalone) {
			setIsInstalled(true);
		}
	}, []);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		const onBeforeInstallPrompt = (event: Event) => {
			const promptEvent = event as BeforeInstallPromptEvent;
			promptEvent.preventDefault();
			setDeferredInstallPrompt(promptEvent);
		};

		const onAppInstalled = () => {
			setIsInstalled(true);
			setDeferredInstallPrompt(null);
		};

		window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
		window.addEventListener("appinstalled", onAppInstalled);

		return () => {
			window.removeEventListener(
				"beforeinstallprompt",
				onBeforeInstallPrompt,
			);
			window.removeEventListener("appinstalled", onAppInstalled);
		};
	}, []);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}

		window.localStorage.setItem(
			HISTORY_STORAGE_KEY,
			JSON.stringify(history),
		);
	}, [history]);

	useEffect(() => {
		setShowRawJson(false);
	}, [activeReportId]);

	const activeReport = useMemo(
		() => history.find((item) => item.id === activeReportId) ?? null,
		[history, activeReportId],
	);

	const currentTest = tests[cursor] ?? null;
	const nextTest = tests[cursor + 1] ?? null;
	const completedCount = results.filter((item): item is TestResult =>
		Boolean(item),
	).length;
	const swipeRatio = Math.max(-1, Math.min(1, dragOffset / SWIPE_THRESHOLD));

	const clearRunState = useCallback(() => {
		if (swipeTimeoutRef.current !== null) {
			clearTimeout(swipeTimeoutRef.current);
			swipeTimeoutRef.current = null;
		}

		setSourcePlan(null);
		setTests([]);
		setCursor(0);
		setResults([]);
		setCommentDrafts({});
		setDragOffset(0);
		setIsDragging(false);
		setExitVerdict(null);
	}, []);

	const openNewPlan = useCallback(() => {
		clearRunState();
		setParseError(null);
		setStep("input");
	}, [clearRunState]);

	const finishRun = useCallback(
		(nextResults: Array<TestResult | null>) => {
			if (!sourcePlan) {
				return;
			}

			const finishedResults = nextResults.filter(
				(item): item is TestResult => Boolean(item),
			);
			const report = buildReport(
				suiteName.trim() || "Untitled Plan",
				sourcePlan,
				finishedResults,
			);

			setHistory((previous) => {
				const nextHistory = [report, ...previous].slice(
					0,
					MAX_HISTORY_ITEMS,
				);
				return nextHistory;
			});
			setActiveReportId(report.id);
			setStep("report");
		},
		[sourcePlan, suiteName],
	);

	const commitVerdict = useCallback(
		(verdict: Verdict) => {
			if (step !== "run") {
				return;
			}

			const target = tests[cursor];
			if (!target) {
				return;
			}

			const comment = (commentDrafts[target.id] ?? "").trim();
			const entry: TestResult = {
				...target,
				verdict,
				comment,
			};

			const nextResults = [...results];
			nextResults[cursor] = entry;

			setResults(nextResults);
			setIsDragging(false);

			const nextCursor = cursor + 1;
			if (nextCursor >= tests.length) {
				finishRun(nextResults);
				return;
			}

			setCursor(nextCursor);
		},
		[step, tests, cursor, commentDrafts, results, finishRun],
	);

	const recordVerdict = useCallback(
		(verdict: Verdict) => {
			if (step !== "run" || exitVerdict) {
				return;
			}

			const target = tests[cursor];
			if (!target) {
				return;
			}

			const screenWidth =
				typeof window !== "undefined" ? window.innerWidth : 480;
			const offscreenDistance = Math.round(screenWidth * 1.2);
			const signedDistance =
				verdict === "pass" ? offscreenDistance : -offscreenDistance;

			if (swipeTimeoutRef.current !== null) {
				clearTimeout(swipeTimeoutRef.current);
				swipeTimeoutRef.current = null;
			}

			setIsDragging(false);
			setExitVerdict(verdict);
			setDragOffset(signedDistance);

			swipeTimeoutRef.current = window.setTimeout(() => {
				commitVerdict(verdict);
				setExitVerdict(null);
				setDragOffset(0);
				swipeTimeoutRef.current = null;
			}, 220);
		},
		[step, exitVerdict, tests, cursor, commitVerdict],
	);

	const undoLast = useCallback(() => {
		if (step !== "run" || cursor === 0 || exitVerdict) {
			return;
		}

		const previousIndex = cursor - 1;
		const nextResults = [...results];
		nextResults[previousIndex] = null;

		setResults(nextResults);
		setCursor(previousIndex);
		setDragOffset(0);
		setIsDragging(false);
	}, [step, cursor, results, exitVerdict]);

	const submitPlan = useCallback(() => {
		if (swipeTimeoutRef.current !== null) {
			clearTimeout(swipeTimeoutRef.current);
			swipeTimeoutRef.current = null;
		}

		try {
			const parsed = parsePlan(jsonDraft);
			setSourcePlan(parsed.source);
			setTests(parsed.flattened);
			setResults(Array(parsed.flattened.length).fill(null));
			setCursor(0);
			setCommentDrafts({});
			setParseError(null);
			setDragOffset(0);
			setIsDragging(false);
			setExitVerdict(null);
			setStep("run");
		} catch (error) {
			if (error instanceof Error) {
				setParseError(error.message);
			} else {
				setParseError("Unable to parse JSON plan.");
			}
		}
	}, [jsonDraft]);

	const importFile = useCallback(
		async (event: ChangeEvent<HTMLInputElement>) => {
			const file = event.target.files?.[0];
			if (!file) {
				return;
			}

			try {
				const contents = await file.text();
				setJsonDraft(contents);
				setParseError(null);
			} catch {
				setParseError("Unable to read the file.");
			} finally {
				event.target.value = "";
			}
		},
		[],
	);

	const updateComment = useCallback((testId: string, value: string) => {
		setCommentDrafts((previous) => ({
			...previous,
			[testId]: value,
		}));
	}, []);

	const handlePointerDown = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			if (exitVerdict) {
				return;
			}

			const target = event.target as HTMLElement;
			if (
				target.closest("textarea, input, button, select, option, label")
			) {
				return;
			}

			pointerRef.current = {
				pointerId: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
				locked: false,
			};
		},
		[exitVerdict],
	);

	const handlePointerMove = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			const pointer = pointerRef.current;
			if (!pointer || pointer.pointerId !== event.pointerId) {
				return;
			}

			const deltaX = event.clientX - pointer.startX;
			const deltaY = event.clientY - pointer.startY;

			if (!pointer.locked) {
				const absX = Math.abs(deltaX);
				const absY = Math.abs(deltaY);

				if (absY > 10 && absY > absX) {
					pointerRef.current = null;
					setIsDragging(false);
					setDragOffset(0);
					return;
				}

				if (absX > 10 && absX >= absY) {
					pointer.locked = true;
					pointerRef.current = pointer;
					setIsDragging(true);
					event.currentTarget.setPointerCapture(event.pointerId);
				} else {
					return;
				}
			}

			setDragOffset(deltaX);
		},
		[],
	);

	const resolvePointerUp = useCallback(
		(deltaX: number) => {
			pointerRef.current = null;

			if (deltaX > SWIPE_THRESHOLD) {
				recordVerdict("pass");
				return;
			}

			if (deltaX < -SWIPE_THRESHOLD) {
				recordVerdict("fail");
				return;
			}

			setDragOffset(0);
			setIsDragging(false);
		},
		[recordVerdict],
	);

	const handlePointerUp = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			const pointer = pointerRef.current;
			if (!pointer || pointer.pointerId !== event.pointerId) {
				return;
			}

			if (
				pointer.locked &&
				event.currentTarget.hasPointerCapture(event.pointerId)
			) {
				event.currentTarget.releasePointerCapture(event.pointerId);
			}

			if (!pointer.locked) {
				pointerRef.current = null;
				setDragOffset(0);
				setIsDragging(false);
				return;
			}

			resolvePointerUp(event.clientX - pointer.startX);
		},
		[resolvePointerUp],
	);

	const handlePointerCancel = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			const pointer = pointerRef.current;
			if (!pointer || pointer.pointerId !== event.pointerId) {
				return;
			}

			pointerRef.current = null;
			setDragOffset(0);
			setIsDragging(false);

			if (event.currentTarget.hasPointerCapture(event.pointerId)) {
				event.currentTarget.releasePointerCapture(event.pointerId);
			}
		},
		[],
	);

	useEffect(() => {
		return () => {
			if (swipeTimeoutRef.current !== null) {
				clearTimeout(swipeTimeoutRef.current);
				swipeTimeoutRef.current = null;
			}
		};
	}, []);

	useEffect(() => {
		if (step !== "run") {
			return;
		}

		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			const tag = target?.tagName?.toLowerCase();
			if (
				tag === "input" ||
				tag === "textarea" ||
				target?.isContentEditable
			) {
				return;
			}

			const key = event.key.toLowerCase();
			if (key === "p" || event.key === "ArrowRight") {
				event.preventDefault();
				recordVerdict("pass");
			}

			if (key === "f" || event.key === "ArrowLeft") {
				event.preventDefault();
				recordVerdict("fail");
			}

			if (
				key === "u" ||
				((event.metaKey || event.ctrlKey) && key === "z")
			) {
				event.preventDefault();
				undoLast();
			}
		};

		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [step, recordVerdict, undoLast]);

	const downloadReport = useCallback((report: SavedReport) => {
		const fileLabel = slugify(report.suiteName) || "qa-report";
		const payload = JSON.stringify(report, null, 2);
		saveFile(`${fileLabel}-${report.id}.json`, payload);
	}, []);

	const deleteReport = useCallback(
		(reportId: string) => {
			const nextHistory = history.filter((item) => item.id !== reportId);
			setHistory(nextHistory);

			if (activeReportId === reportId) {
				setActiveReportId(nextHistory[0]?.id ?? null);
			}
		},
		[history, activeReportId],
	);

	const clearHistory = useCallback(() => {
		setHistory([]);
		setActiveReportId(null);
	}, []);

	const triggerInstall = useCallback(async () => {
		if (!deferredInstallPrompt) {
			return;
		}

		setIsInstalling(true);
		try {
			await deferredInstallPrompt.prompt();
			const choice = await deferredInstallPrompt.userChoice;
			if (choice.outcome === "accepted") {
				setDeferredInstallPrompt(null);
			}
		} finally {
			setIsInstalling(false);
		}
	}, [deferredInstallPrompt]);

	const dismissInstallPrompt = useCallback(() => {
		setInstallDismissed(true);
		if (typeof window !== "undefined") {
			window.localStorage.setItem(INSTALL_PROMPT_DISMISS_KEY, "1");
		}
	}, []);

	const showInstallPrompt =
		step === "start" &&
		!isInstalled &&
		!installDismissed &&
		Boolean(deferredInstallPrompt);

	return (
		<main className="app-shell">
			<section className="frame">
				<header className="title-card">
					<span>Testr</span>
				</header>

				{step === "start" && (
					<section className="panel start-panel">
						<h1>Run test actions like a swipe deck.</h1>
						<p>
							Flow: Start -&gt; Enter plan (paste JSON or import
							file) -&gt; Swipe Pass/Fail with optional comments
							-&gt; Report -&gt; Print or export JSON.
						</p>
						<div className="button-row">
							<button
								type="button"
								className="action-btn mint"
								onClick={openNewPlan}
							>
								Start New Session
							</button>
							<button
								type="button"
								className="action-btn blue"
								onClick={() => setStep("report")}
								disabled={!history.length}
							>
								Open Report History
							</button>
						</div>

						{showInstallPrompt && (
							<div className="install-card">
								<h2>Install QA Swipe Console</h2>
								<p>
									Add this app to your device for faster
									access, full-screen mode, and offline
									report review.
								</p>
								<div className="button-row compact">
									<button
										type="button"
										className="action-btn mint"
										onClick={triggerInstall}
										disabled={isInstalling}
									>
										{isInstalling
											? "Opening Installer..."
											: "Install App"}
									</button>
									<button
										type="button"
										className="action-btn peach"
										onClick={dismissInstallPrompt}
									>
										Don&apos;t Show Again
									</button>
								</div>
							</div>
						)}

						{history[0] && (
							<div className="mini-card">
								<h2>Most Recent Report</h2>
								<p>{history[0].suiteName}</p>
								<p>{formatDate(history[0].createdAt)}</p>
								<p>
									{history[0].passed} pass /{" "}
									{history[0].failed} fail
								</p>
							</div>
						)}
					</section>
				)}

				{step === "input" && (
					<section className="panel input-panel">
						<div className="panel-head">
							<button
								type="button"
								className="inline-btn"
								onClick={() => setStep("start")}
							>
								Home
							</button>
							<span>Plan Input</span>
						</div>

						<label className="field">
							<span>Suite Name</span>
							<input
								type="text"
								value={suiteName}
								onChange={(event) =>
									setSuiteName(event.target.value)
								}
								placeholder="Regression Plan"
							/>
						</label>

						<div className="button-row compact">
							<label className="action-btn peach file-btn">
								Import JSON File
								<input
									type="file"
									accept="application/json,.json"
									onChange={importFile}
								/>
							</label>
							<button
								type="button"
								className="action-btn lilac"
								onClick={() => {
									setJsonDraft(SAMPLE_PLAN);
									setParseError(null);
								}}
							>
								Use Sample
							</button>
						</div>

						<label className="field">
							<span>Paste Test Plan JSON</span>
							<textarea
								value={jsonDraft}
								onChange={(event) =>
									setJsonDraft(event.target.value)
								}
								rows={14}
								spellCheck={false}
							/>
						</label>

						{parseError && (
							<p className="error-line">{parseError}</p>
						)}

						<div className="button-row compact">
							<button
								type="button"
								className="action-btn mint"
								onClick={submitPlan}
							>
								Load Plan and Start Swiping
							</button>
						</div>
					</section>
				)}

				{step === "run" && currentTest && (
					<section className="panel run-panel">
						<div className="panel-head">
							<button
								type="button"
								className="inline-btn"
								onClick={openNewPlan}
							>
								Change Plan
							</button>
							<span>
								Test {cursor + 1} / {tests.length}
							</span>
						</div>

						<div className="progress-track">
							<div
								className="progress-fill"
								style={{
									width: `${tests.length ? (completedCount / tests.length) * 100 : 0}%`,
								}}
							/>
						</div>

						<div className="deck-area">
							{nextTest && (
								<article className="test-card ghost">
									<p className="card-kicker">
										Up Next: {nextTest.category}
									</p>
									<h3>{nextTest.action}</h3>
								</article>
							)}

							<article
								className="test-card current"
								style={{
									transform: `translateX(${dragOffset}px) rotate(${dragOffset / 24}deg)`,
									opacity: exitVerdict ? 0 : 1,
									transition: isDragging
										? "none"
										: "transform 220ms cubic-bezier(0.18, 0.88, 0.32, 1), opacity 220ms ease",
								}}
								onPointerDown={handlePointerDown}
								onPointerMove={handlePointerMove}
								onPointerUp={handlePointerUp}
								onPointerCancel={handlePointerCancel}
							>
								<span
									className="swipe-pill fail"
									style={{
										opacity: Math.max(0, -swipeRatio),
									}}
								>
									FAIL
								</span>
								<span
									className="swipe-pill pass"
									style={{ opacity: Math.max(0, swipeRatio) }}
								>
									PASS
								</span>

								<p className="card-kicker">
									{currentTest.category}
								</p>
								<h2>{currentTest.action}</h2>
								<p className="expected-line">
									Expected: {currentTest.expected}
								</p>

								<label className="field">
									<span>Comments</span>
									<textarea
										value={
											commentDrafts[currentTest.id] ?? ""
										}
										onChange={(event) =>
											updateComment(
												currentTest.id,
												event.target.value,
											)
										}
										placeholder="Example: Works in Chrome, fails in Safari after login redirect."
										rows={4}
									/>
								</label>
							</article>
						</div>

						<div className="button-row run-controls">
							<button
								type="button"
								className="action-btn rose"
								onClick={() => recordVerdict("fail")}
								disabled={Boolean(exitVerdict)}
							>
								Fail (F / ←)
							</button>
							<button
								type="button"
								className="action-btn peach"
								onClick={undoLast}
								disabled={cursor === 0 || Boolean(exitVerdict)}
							>
								Undo (U)
							</button>
							<button
								type="button"
								className="action-btn mint"
								onClick={() => recordVerdict("pass")}
								disabled={Boolean(exitVerdict)}
							>
								Pass (P / →)
							</button>
						</div>

						<p className="hint-line">
							Swipe left for fail, right for pass. Keyboard
							shortcuts: P, F, Left Arrow, Right Arrow.
						</p>
					</section>
				)}

				{step === "report" && (
					<section className="panel report-panel">
						<div className="panel-head">
							<button
								type="button"
								className="inline-btn"
								onClick={() => setStep("start")}
							>
								Home
							</button>
							<span>Reports</span>
						</div>

						{!activeReport && !history.length && (
							<div className="empty-box">
								<p>No saved reports yet.</p>
								<button
									type="button"
									className="action-btn mint"
									onClick={openNewPlan}
								>
									Start First Session
								</button>
							</div>
						)}

						{activeReport && (
							<>
								<div className="button-row compact print-hide">
									<button
										type="button"
										className="action-btn mint"
										onClick={openNewPlan}
									>
										New Session
									</button>
									<button
										type="button"
										className="action-btn blue"
										onClick={() => window.print()}
									>
										Print Report
									</button>
									<button
										type="button"
										className="action-btn lilac"
										onClick={() =>
											downloadReport(activeReport)
										}
									>
										Download JSON
									</button>
								</div>

								<article className="report-card print-card">
									<div className="report-head">
										<h2>{activeReport.suiteName}</h2>
										<p>
											{formatDate(activeReport.createdAt)}
										</p>
									</div>

									<div className="summary-grid">
										<div className="summary-box mint">
											<span>Total</span>
											<strong>
												{activeReport.total}
											</strong>
										</div>
										<div className="summary-box green">
											<span>Pass</span>
											<strong>
												{activeReport.passed}
											</strong>
										</div>
										<div className="summary-box rose">
											<span>Fail</span>
											<strong>
												{activeReport.failed}
											</strong>
										</div>
									</div>

									<h3>Category Summary</h3>
									<div className="category-grid">
										{Object.entries(
											activeReport.byCategory,
										).map(([category, categorySummary]) => (
											<article
												className="category-card"
												key={category}
											>
												<h4>{category}</h4>
												<p>
													{categorySummary.passed}{" "}
													pass /{" "}
													{categorySummary.failed}{" "}
													fail (
													{categorySummary.total}
													total)
												</p>
											</article>
										))}
									</div>

									<h3>Detailed Results</h3>
									<ol className="result-list">
										{activeReport.results.map((result) => (
											<li
												key={`${activeReport.id}-${result.id}`}
												className={`result-item ${result.verdict}`}
											>
												<div>
													<span className="result-tag">
														{result.verdict.toUpperCase()}
													</span>
													<p className="result-action">
														{result.action}
													</p>
													<p className="result-expected">
														Expected:{" "}
														{result.expected}
													</p>
													{result.comment && (
														<p className="result-comment">
															Comment:{" "}
															{result.comment}
														</p>
													)}
												</div>
												<span className="category-pill">
													{result.category}
												</span>
											</li>
										))}
									</ol>

									<div className="json-toggle print-hide">
										<button
											type="button"
											className="inline-btn"
											onClick={() =>
												setShowRawJson((prev) => !prev)
											}
										>
											{showRawJson
												? "Hide JSON"
												: "Show JSON"}
										</button>
										{showRawJson && (
											<pre className="json-block">
												{JSON.stringify(
													activeReport,
													null,
													2,
												)}
											</pre>
										)}
									</div>
								</article>
							</>
						)}

						{!!history.length && (
							<aside className="history-column print-hide">
								<div className="history-head">
									<h3>Saved History</h3>
									<button
										type="button"
										className="inline-btn"
										onClick={clearHistory}
									>
										Clear All
									</button>
								</div>
								<ul>
									{history.map((entry) => (
										<li
											key={entry.id}
											className={
												entry.id === activeReportId
													? "active"
													: ""
											}
										>
											<button
												type="button"
												onClick={() =>
													setActiveReportId(entry.id)
												}
											>
												<span>{entry.suiteName}</span>
												<small>
													{formatDate(
														entry.createdAt,
													)}
												</small>
												<small>
													{entry.passed} pass /{" "}
													{entry.failed} fail
												</small>
											</button>
											<div className="history-actions">
												<button
													type="button"
													className="inline-btn"
													onClick={() =>
														downloadReport(entry)
													}
												>
													JSON
												</button>
												<button
													type="button"
													className="inline-btn"
													onClick={() =>
														deleteReport(entry.id)
													}
												>
													Delete
												</button>
											</div>
										</li>
									))}
								</ul>
							</aside>
						)}
					</section>
				)}
			</section>
		</main>
	);
}
