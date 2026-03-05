/**
 * Patient simulation script — Maria Kowalski suspected vEDS case.
 *
 * Spawns the Asklepios CLI as a child process, sends messages as a simulated patient,
 * captures agent responses, and logs everything for observability analysis.
 */
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';

const SESSION_TS = new Date().toISOString().replace(/[:.]/g, '-');
const LOG_FILE = `logs/session-${SESSION_TS}-debug.log`;
const STDOUT_FILE = `logs/session-${SESSION_TS}-chat.log`;

// Patient messages — complex vEDS case with multi-turn conversation
const MESSAGES: Array<{ message: string; waitMs: number; label: string }> = [
	{
		label: 'Initial presentation',
		waitMs: 50000,
		message:
			"Hi, I'm here about my case. I'm Maria, 32 years old. I've been struggling with health issues for about 8 years and nobody can figure out what's wrong with me. I was originally diagnosed with fibromyalgia at 24, then anxiety disorder, then IBS. But something happened 3 months ago that scared everyone - I had a spontaneous dissection of my left iliac artery. I'm wondering if these are all connected.",
	},
	{
		label: 'Detailed symptoms',
		waitMs: 50000,
		message:
			"Let me tell you more about my symptoms. I bruise really easily - sometimes I wake up with bruises I don't remember getting. My skin is thin and translucent - you can see my veins through it, especially on my chest and arms. I have a distinctive facial appearance - thin lips, small chin, prominent eyes, thin nose. My joints aren't particularly hypermobile though, which is why nobody suspected EDS. I also get severe GI problems - spontaneous perforation of my sigmoid colon happened when I was 28. They thought it was diverticulitis but I was way too young for that.",
	},
	{
		label: 'Family history',
		waitMs: 50000,
		message:
			'My family history is complicated. My father died at 41 from what they called a "sudden cardiac event" - they found he had an aortic dissection at autopsy. My paternal grandmother died young too, in her 50s, from internal bleeding they couldn\'t stop after a minor surgery. My brother, who is 29, has similar thin skin and he just had a spontaneous pneumothorax last year. Nobody in my family has been genetically tested.',
	},
	{
		label: 'Clinical document upload',
		waitMs: 70000,
		message: `I have my recent genetics clinic referral letter. Here's what it says:

REFERRAL FOR GENETIC EVALUATION
Patient: Maria Kowalski, 32F
Referring physician: Dr. James Chen, Vascular Surgery
Date: January 15, 2026

Clinical Summary:
32-year-old female presenting with spontaneous left iliac artery dissection (October 2025), history of sigmoid colon perforation at age 28, extensive easy bruising, thin translucent skin with visible venous pattern, and characteristic facial features (acrogeria). Family history significant for premature death in father (aortic dissection, age 41) and paternal grandmother (surgical bleeding complications, age 52). Brother with spontaneous pneumothorax at age 28.

Current medications: Celiprolol 200mg BID (started post-dissection), Vitamin C 1000mg daily.
Allergies: NSAIDs (excessive bruising).

Physical examination: Thin habitus, BMI 19.2. Skin: thin, translucent, visible venous pattern on chest and forearms. Facial features: thin lips, micrognathia, prominent eyes, lobeless ears. Beighton score: 2/9 (mild). No skin hyperextensibility. Multiple ecchymoses on extremities.

Assessment: High clinical suspicion for vascular Ehlers-Danlos syndrome (vEDS). COL3A1 genetic testing requested. Recommend avoiding invasive procedures, contact sports, and arterial catheterization until confirmed.

Can you analyze this document and tell me what you think?`,
	},
	{
		label: 'Research query',
		waitMs: 50000,
		message:
			"What does the medical literature say about COL3A1 mutations and vascular EDS? I'm particularly interested in the prognosis and whether celiprolol actually helps. My vascular surgeon mentioned a French study about it.",
	},
	{
		label: 'Differential diagnosis',
		waitMs: 50000,
		message:
			"Are there other conditions that could explain my symptoms if it's not vEDS? I read online about Loeys-Dietz syndrome and Marfan syndrome. How would you differentiate between these?",
	},
	{
		label: 'Switch to brother case',
		waitMs: 5000,
		message: '/patient maria-brother',
	},
	{
		label: "Brother's case discussion",
		waitMs: 50000,
		message:
			"I want to also discuss my brother's case. He's 29, has thin skin similar to mine, had a spontaneous pneumothorax, and gets nosebleeds frequently. He hasn't had any arterial events yet but we're worried. What symptoms should we watch for and what testing should he get?",
	},
	{
		label: 'Switch back to Maria',
		waitMs: 5000,
		message: '/patient maria-kowalski',
	},
	{
		label: 'Cross-patient pattern query',
		waitMs: 50000,
		message:
			"Based on what you know about my case and my brother's case, do you see any patterns? Can you check your knowledge base for similar cases?",
	},
	{
		label: 'Check status',
		waitMs: 3000,
		message: '/status',
	},
	{
		label: 'Check usage',
		waitMs: 3000,
		message: '/usage',
	},
	{
		label: 'Action plan request',
		waitMs: 60000,
		message:
			'What are the most important next steps for me and my family? Please give me a prioritized action plan.',
	},
	{
		label: 'Quit',
		waitMs: 2000,
		message: '/quit',
	},
];

async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
	const debugLog = createWriteStream(LOG_FILE);
	const chatLog = createWriteStream(STDOUT_FILE);

	const timestamp = () => new Date().toISOString();
	const logDebug = (msg: string) => {
		const line = `[${timestamp()}] ${msg}\n`;
		debugLog.write(line);
		process.stderr.write(line);
	};

	logDebug('=== Starting patient simulation: Maria Kowalski (suspected vEDS) ===');
	logDebug(`Messages planned: ${MESSAGES.length}`);
	logDebug(`Total estimated time: ${Math.round(MESSAGES.reduce((sum, m) => sum + m.waitMs, 0) / 1000 / 60)} minutes`);

	// Spawn CLI
	const cli = spawn('node', ['dist/cli.js', '--patient', 'maria-kowalski'], {
		cwd: process.cwd(),
		env: { ...process.env, LOG_LEVEL: 'debug' },
		stdio: ['pipe', 'pipe', 'pipe'],
	});

	// Capture stdout (agent responses)
	cli.stdout.on('data', (chunk: Buffer) => {
		const text = chunk.toString();
		chatLog.write(text);
		process.stdout.write(text);
	});

	// Capture stderr (debug logs, observability traces)
	cli.stderr.on('data', (chunk: Buffer) => {
		const text = chunk.toString();
		debugLog.write(`[STDERR] ${text}`);
	});

	// Wait for CLI to initialize
	await sleep(3000);

	// Send each message with appropriate delay
	for (let i = 0; i < MESSAGES.length; i++) {
		const msg = MESSAGES[i]!;
		logDebug(`\n--- Turn ${i + 1}/${MESSAGES.length}: ${msg.label} ---`);
		logDebug(`Sending: ${msg.message.slice(0, 100)}${msg.message.length > 100 ? '...' : ''}`);

		cli.stdin.write(msg.message + '\n');

		logDebug(`Waiting ${msg.waitMs / 1000}s for response...`);
		await sleep(msg.waitMs);

		logDebug(`Turn ${i + 1} complete.`);
	}

	// Wait for final output
	await sleep(3000);

	logDebug('\n=== Session complete ===');

	// Clean up
	cli.stdin.end();
	debugLog.end();
	chatLog.end();

	// Wait for process to exit
	await new Promise<void>((resolve) => {
		cli.on('close', () => resolve());
		setTimeout(() => {
			cli.kill();
			resolve();
		}, 5000);
	});
}

main().catch(console.error);
