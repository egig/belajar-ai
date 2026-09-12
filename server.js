import "dotenv/config"
import express from "express"
import OpenAI from "openai"

const app = express();

app.use(express.json())
app.use(express.static("./public"))

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: process.env.OPENAI_BASE_URL });

app.post("/api/chat", async (req, res) => {
	const { message } = req.body ?? {};

	if (!message || typeof message !== "string") {
		return res.status(400).json({ error: "message wajib diisi" });
	}

	try {
		const completion = await openai.chat.completions.create({
			model: process.env.MODEL,
			messages: [{ role: "user", content: message }],
		});

		res.json({ reply: completion.choices[0].message.content });
	} catch (err) {
		console.error(err);
		res.status(500).json({ error: "gagal menghubungi OpenAI" });
	}
});

const PORT = 3000;
app.listen(PORT, () => {
	console.log("aplikasi jalan di port " + PORT)
})
