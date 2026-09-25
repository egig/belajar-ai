import "dotenv/config"
import express from "express"
import OpenAI from "openai"

const app = express();

app.use(express.json())
app.use(express.static("./public"))

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: process.env.OPENAI_BASE_URL });

let chatHistory = [];
let lastUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
let cumulativeUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

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

app.get("/api/chat", (req, res) => {
	res.json({ history: chatHistory, totalUsage: lastUsage, cumulativeUsage });
});

app.get("/api/model-info", async (req, res) => {
	res.json({ model: process.env.MODEL, limits: await getModelLimits() });
});

app.post("/api/chat", async (req, res) => {
	const { message } = req.body ?? {};

	if (!message || typeof message !== "string") {
		return res.status(400).json({ error: "message wajib diisi" });
	}

	chatHistory.push({ role: "user", content: message });

	try {
		const completion = await openai.chat.completions.create({
			model: process.env.MODEL,
			messages: chatHistory,
		});

		const reply = completion.choices[0].message.content;
		chatHistory.push({ role: "assistant", content: reply });

		const usage = completion.usage ?? null;
		if (usage) {
			lastUsage = usage;
			cumulativeUsage.prompt_tokens += usage.prompt_tokens ?? 0;
			cumulativeUsage.completion_tokens += usage.completion_tokens ?? 0;
			cumulativeUsage.total_tokens += usage.total_tokens ?? 0;
		}

		res.json({ reply, usage, totalUsage: lastUsage, cumulativeUsage });
	} catch (err) {
		chatHistory.pop();
		console.error(err);
		res.status(500).json({ error: "gagal menghubungi OpenAI" });
	}
});

const PORT = 3000;
app.listen(PORT, () => {
	console.log("aplikasi jalan di port " + PORT)
})
