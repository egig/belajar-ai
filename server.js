import "dotenv/config"
import express from "express"
import OpenAI from "openai"
import { initDb } from "./db.js"
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
	res.json({ history: await getMessages(threadId), totalUsage: usage.last, cumulativeUsage: usage.cumulative });
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
		const history = await getMessages(threadId);
		const stream = await openai.chat.completions.create({
			model: process.env.MODEL,
			messages: [
				...(systemInstruction ? [{ role: "system", content: systemInstruction }] : []),
				...history,
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
