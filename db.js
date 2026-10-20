import pg from "pg"

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

export async function initDb() {
	await pool.query(`
		CREATE TABLE IF NOT EXISTS threads (
			id         BIGSERIAL PRIMARY KEY,
			title      TEXT,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		);
		CREATE TABLE IF NOT EXISTS settings (
			key   TEXT PRIMARY KEY,
			value TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS messages (
			id                BIGSERIAL PRIMARY KEY,
			thread_id         BIGINT REFERENCES threads(id) ON DELETE CASCADE,
			role              TEXT NOT NULL,
			content           TEXT NOT NULL,
			prompt_tokens     INTEGER,
			completion_tokens INTEGER,
			total_tokens      INTEGER,
			created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
		);
		ALTER TABLE messages ADD COLUMN IF NOT EXISTS thread_id BIGINT REFERENCES threads(id) ON DELETE CASCADE;
		ALTER TABLE messages ADD COLUMN IF NOT EXISTS prompt_tokens INTEGER;
		ALTER TABLE messages ADD COLUMN IF NOT EXISTS completion_tokens INTEGER;
		ALTER TABLE messages ADD COLUMN IF NOT EXISTS total_tokens INTEGER;
		CREATE INDEX IF NOT EXISTS messages_thread_id_idx ON messages (thread_id, id);
	`)

	// pesan dari sebelum ada thread dipindahkan ke satu thread lama
	const { rows } = await pool.query("SELECT 1 FROM messages WHERE thread_id IS NULL LIMIT 1")
	if (rows.length) {
		const { rows: [thread] } = await pool.query("INSERT INTO threads (title) VALUES ('Percakapan lama') RETURNING id")
		await pool.query("UPDATE messages SET thread_id = $1 WHERE thread_id IS NULL", [thread.id])
	}
}
