import "dotenv/config"
import express from "express"
import OpenAI from "openai"
import { initDb } from "./db.js"
import { planContext, summarizeHistory } from "./context.js"
import {
	listThreads,
	createThread,
	threadExists,
	getSetting,
	setSetting,
	deleteThread,
	saveMessage,
	getMessages,
	getUsage,
	getThreadSummary,
	saveThreadSummary,
} from "./store.js"

const app = express();

app.use(express.json())
app.use(express.static("./public"))

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: process.env.OPENAI_BASE_URL });

let modelLimits = null;
async function getModelLimits() {
	if (modelLimits) return modelLimits;
	if (!process.env.OPENAI_BASE_URL?.includes("openrouter.ai")) return null;

	try {
		const res = await fetch(`${process.env.OPENAI_BASE_URL}/models/${process.env.MODEL}/endpoints`);
		const data = await res.json();
		const endpoint = data?.data?.endpoints?.[0];
		modelLimits = {
			contextLength: endpoint?.context_length ?? null,
			maxCompletionTokens: endpoint?.max_completion_tokens ?? null,
		};
	} catch (err) {
		console.error("gagal ambil info model dari OpenRouter", err);
		modelLimits = null;
	}

	return modelLimits;
}

const parseId = (v) => (/^\d+$/.test(String(v)) ? Number(v) : null);

app.get("/api/threads", async (req, res) => {
	res.json({ threads: await listThreads() });
});

app.post("/api/threads", async (req, res) => {
	res.status(201).json(await createThread());
});

app.delete("/api/threads/:id", async (req, res) => {
	const id = parseId(req.params.id);
	if (id === null) return res.status(400).json({ error: "id tidak valid" });
	await deleteThread(id);
	res.status(204).end();
});

// ringkas manual: semua pesan yang belum diringkas digabung ke ringkasan thread
app.post("/api/threads/:id/compact", async (req, res) => {
	const id = parseId(req.params.id);
	if (id === null || !(await threadExists(id))) return res.status(404).json({ error: "thread tidak ditemukan" });

	try {
		const { summary, cursor } = await getThreadSummary(id);
		const history = await getMessages(id);
		const updated = await summarizeHistory({ openai, model: process.env.MODEL, summary, dropped: history, cursor });
		if (!updated) return res.json({ summary, summaryCursor: cursor, compacted: 0 });

		await saveThreadSummary(id, updated.summary, updated.cursor);
		res.json({
			summary: updated.summary,
			summaryCursor: updated.cursor,
			compacted: history.filter((m) => m.id > cursor).length,
		});
	} catch (err) {
		console.error(err);
		res.status(500).json({ error: "gagal meringkas obrolan" });
	}
});

app.get("/api/settings", async (req, res) => {
	res.json({ systemInstruction: await getSetting("system_instruction") });
});

app.put("/api/settings", async (req, res) => {
	const { systemInstruction: value } = req.body ?? {};

	if (typeof value !== "string") {
		return res.status(400).json({ error: "systemInstruction harus berupa teks" });
	}

	await setSetting("system_instruction", value.trim());
	res.json({ systemInstruction: value.trim() });
});

app.get("/api/chat", async (req, res) => {
	const threadId = parseId(req.query.threadId);
	if (threadId === null) return res.status(400).json({ error: "threadId wajib diisi" });

	const usage = await getUsage(threadId);
	const { summary, cursor } = await getThreadSummary(threadId);
	res.json({
		history: await getMessages(threadId),
		summary,
		summaryCursor: cursor,
		totalUsage: usage.last,
		cumulativeUsage: usage.cumulative,
	});
});

app.get("/api/model-info", async (req, res) => {
	res.json({ model: process.env.MODEL, limits: await getModelLimits() });
});

app.post("/api/chat", async (req, res) => {
	const { message } = req.body ?? {};
	const threadId = parseId(req.body?.threadId);

	if (!message || typeof message !== "string") {
		return res.status(400).json({ error: "message wajib diisi" });
	}
	if (threadId === null || !(await threadExists(threadId))) {
		return res.status(404).json({ error: "thread tidak ditemukan" });
	}

	res.setHeader("Content-Type", "text/plain; charset=utf-8");

	let reply = "";
	let usage = null;
	try {
		const systemInstruction = await getSetting("system_instruction");
		const limits = await getModelLimits();
		const { summary, cursor } = await getThreadSummary(threadId);
		// pesan yang sudah masuk ringkasan tidak dikirim ulang
		const history = (await getMessages(threadId)).filter((m) => m.id > cursor);

		//potong riwayat lama (trim), lalu ringkas yang dipotong (summarize)
		const { recent, dropped } = planContext({ history, summary, systemInstruction, message, limits });
		let activeSummary = summary;
		if (dropped.length) {
			try {
				const updated = await summarizeHistory({ openai, model: process.env.MODEL, summary, dropped, cursor });
				if (updated) {
					activeSummary = updated.summary;
					await saveThreadSummary(threadId, updated.summary, updated.cursor);
				}
			} catch (err) {
				console.error("gagal meringkas konteks, lanjut dengan pemotongan", err);
			}
		}

		const systemContent = [systemInstruction, activeSummary && `Ringkasan percakapan sebelumnya:\n${activeSummary}`]
			.filter(Boolean)
			.join("\n\n");

		const stream = await openai.chat.completions.create({
			model: process.env.MODEL,
			messages: [
				...(systemContent ? [{ role: "system", content: systemContent }] : []),
				...recent.map(({ role, content }) => ({ role, content })),
				{ role: "user", content: message },
			],
			stream: true,
			stream_options: { include_usage: true },
		});

		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta?.content ?? "";
			if (delta) {
				reply += delta;
				res.write(delta);
			}
			if (chunk.usage) usage = chunk.usage;
		}

		await saveMessage(threadId, "user", message);
		await saveMessage(threadId, "assistant", reply, usage);
		res.end();
	} catch (err) {
		console.error(err);
		if (!res.headersSent) {
			res.status(500).json({ error: "gagal menghubungi OpenAI" });
		} else {
			res.end();
		}
	}
});

await initDb();

const PORT = 3000;
app.listen(PORT, () => {
	console.log("aplikasi jalan di port " + PORT)
})
