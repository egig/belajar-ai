// Manajemen konteks hibrida: potong (trim) pesan lama, lalu ringkas (summarize) yang dipotong.

const CHARS_PER_TOKEN = 4;
const DEFAULT_CONTEXT_LENGTH = 32000;
const DEFAULT_MAX_COMPLETION = 1024;
const SAFETY_MARGIN = 512;
const KEEP_RECENT_RATIO = 0.5; // porsi anggaran prompt yang dikirim utuh
const SUMMARIZE_TRIGGER_RATIO = 0.4; // mulai meringkas saat riwayat melewati porsi ini
const MIN_RECENT_MESSAGES = 4; // selalu kirim sekian pesan terakhir apa adanya

const SUMMARY_SYSTEM_PROMPT = `Kamu merangkum riwayat percakapan agar konteks tetap ringkas.
Tulis ringkasan padat dalam bahasa yang sama dengan percakapan.
Pertahankan fakta penting, keputusan, preferensi pengguna, dan hal yang belum selesai.
Jangan menambah informasi yang tidak ada di percakapan.`

export function estimateTokens(text) {
	return Math.ceil(String(text ?? "").length / CHARS_PER_TOKEN)
}

export function estimateMessageTokens(message) {
	return estimateTokens(message.content) + 4
}

export function estimateMessagesTokens(messages) {
	return messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0)
}

export function promptBudget(limits) {
	const contextLength = limits?.contextLength ?? DEFAULT_CONTEXT_LENGTH
	const reserve = (limits?.maxCompletionTokens ?? DEFAULT_MAX_COMPLETION) + SAFETY_MARGIN
	return Math.max(contextLength - reserve, DEFAULT_MAX_COMPLETION)
}

// Bagi riwayat jadi `recent` (dikirim utuh) dan `dropped` (akan diringkas).
export function splitHistory(history, keepBudget) {
	const recent = []
	let used = 0
	for (let i = history.length - 1; i >= 0; i--) {
		const tokens = estimateMessageTokens(history[i])
		if (recent.length >= MIN_RECENT_MESSAGES && used + tokens > keepBudget) break
		used += tokens
		recent.unshift(history[i])
	}
	return { recent, dropped: history.slice(0, history.length - recent.length) }
}

// Selama masih muat, kirim semua riwayat. Kalau tidak, potong + ringkas.
export function planContext({ history, summary, systemInstruction, message, limits }) {
	const budget = promptBudget(limits)
	const total =
		estimateTokens(systemInstruction) +
		estimateTokens(summary) +
		estimateMessagesTokens(history) +
		estimateTokens(message)

	if (total <= budget * SUMMARIZE_TRIGGER_RATIO) {
		return { recent: history, dropped: [] }
	}
	return splitHistory(history, budget * KEEP_RECENT_RATIO)
}

// Ringkas pesan yang baru dipotong (id > cursor) dan gabungkan dengan ringkasan lama.
export async function summarizeHistory({ openai, model, summary, dropped, cursor }) {
	const toSummarize = dropped.filter((m) => m.id > cursor)
	if (toSummarize.length === 0) return null

	const transcript = toSummarize.map((m) => `${m.role}: ${m.content}`).join("\n\n")
	const res = await openai.chat.completions.create({
		model,
		messages: [
			{ role: "system", content: SUMMARY_SYSTEM_PROMPT },
			{
				role: "user",
				content: [summary ? `Ringkasan sejauh ini:\n${summary}` : "", `Percakapan baru untuk diringkas:\n${transcript}`]
					.filter(Boolean)
					.join("\n\n"),
			},
		],
	})

	return {
		summary: res.choices?.[0]?.message?.content?.trim() || summary,
		cursor: toSummarize[toSummarize.length - 1].id,
	}
}
