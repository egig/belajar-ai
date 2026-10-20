import { pool } from "./db.js"

export async function listThreads() {
	const { rows } = await pool.query(
		`SELECT t.id, t.title FROM threads t
		 ORDER BY COALESCE((SELECT max(m.id) FROM messages m WHERE m.thread_id = t.id), 0) DESC, t.id DESC`,
	)
	return rows
}

export async function createThread() {
	const { rows } = await pool.query("INSERT INTO threads DEFAULT VALUES RETURNING id, title")
	return rows[0]
}

export async function threadExists(id) {
	const { rowCount } = await pool.query("SELECT 1 FROM threads WHERE id = $1", [id])
	return rowCount > 0
}

// Pengaturan global (key/value), berlaku untuk semua thread.
export async function getSetting(key, fallback = "") {
	const { rows } = await pool.query("SELECT value FROM settings WHERE key = $1", [key])
	return rows[0]?.value ?? fallback
}

export async function setSetting(key, value) {
	await pool.query(
		"INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
		[key, value],
	)
}

export async function deleteThread(id) {
	await pool.query("DELETE FROM threads WHERE id = $1", [id])
}

export async function saveMessage(threadId, role, content, usage = null) {
	await pool.query(
		`INSERT INTO messages (thread_id, role, content, prompt_tokens, completion_tokens, total_tokens)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		[threadId, role, content, usage?.prompt_tokens ?? null, usage?.completion_tokens ?? null, usage?.total_tokens ?? null],
	)
	if (role === "user") {
		await pool.query("UPDATE threads SET title = left($2, 40) WHERE id = $1 AND title IS NULL", [threadId, content])
	}
}

export async function getMessages(threadId) {
	const { rows } = await pool.query("SELECT role, content FROM messages WHERE thread_id = $1 ORDER BY id", [threadId])
	return rows
}

// pemakaian token thread: last = panggilan terakhir, cumulative = jumlah semua panggilan
export async function getUsage(threadId) {
	const { rows: [last] } = await pool.query(
		`SELECT prompt_tokens, completion_tokens, total_tokens FROM messages
		 WHERE thread_id = $1 AND total_tokens IS NOT NULL ORDER BY id DESC LIMIT 1`,
		[threadId],
	)
	const { rows: [sum] } = await pool.query(
		`SELECT COALESCE(sum(prompt_tokens), 0)::int AS prompt_tokens,
		        COALESCE(sum(completion_tokens), 0)::int AS completion_tokens,
		        COALESCE(sum(total_tokens), 0)::int AS total_tokens
		 FROM messages WHERE thread_id = $1`,
		[threadId],
	)
	return { last: last ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, cumulative: sum }
}
