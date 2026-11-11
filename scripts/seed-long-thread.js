// Buat satu thread dummy dengan riwayat panjang (~128.000 token) untuk menguji trim + ringkasan.
// Pakai: node scripts/seed-long-thread.js [targetTokens]
import "dotenv/config"
import { pool, initDb } from "../db.js"
import { estimateMessageTokens } from "../context.js"

const TARGET_TOKENS = Number(process.argv[2]) || 128000
const BATCH_SIZE = 200

const TOPICS = [
	"resep nasi goreng", "liburan ke Bali", "belajar JavaScript", "mengatur keuangan bulanan",
	"merawat tanaman hias", "olahraga lari pagi", "membuat API dengan Express", "sejarah Majapahit",
	"memilih laptop", "menulis CV", "indeks database PostgreSQL", "kebiasaan tidur sehat",
]

const FILLER = `Detail tambahan: pertimbangkan anggaran, waktu yang tersedia, dan prioritas pribadi.
Catat setiap keputusan supaya mudah ditinjau ulang nanti. Bandingkan beberapa pilihan sebelum memutuskan,
lalu evaluasi hasilnya setelah satu minggu. Jika ada kendala, pecah masalah menjadi langkah-langkah kecil.`

function userMessage(i, topic) {
	return `Pertanyaan #${i}: Bisa jelaskan lebih lanjut soal ${topic}? Saya ingin tahu langkah praktisnya.`
}

function assistantMessage(i, topic) {
	const points = Array.from({ length: 6 }, (_, k) => `${k + 1}. Poin ${k + 1} tentang ${topic} (balasan #${i}).`)
	return [`Tentu, berikut penjelasan soal ${topic}:`, ...points, FILLER, FILLER].join("\n")
}

async function main() {
	await initDb()

	const { rows: [thread] } = await pool.query(
		"INSERT INTO threads (title) VALUES ($1) RETURNING id",
		[`Stub ${Math.round(TARGET_TOKENS / 1000)}k token`],
	)

	let total = 0
	let count = 0
	let batch = []

	const flush = async () => {
		if (!batch.length) return
		const values = batch.map((_, j) => `($1, $${j * 2 + 2}, $${j * 2 + 3})`).join(", ")
		const params = [thread.id, ...batch.flatMap((m) => [m.role, m.content])]
		await pool.query(`INSERT INTO messages (thread_id, role, content) VALUES ${values}`, params)
		batch = []
	}

	for (let i = 1; total < TARGET_TOKENS; i++) {
		const topic = TOPICS[i % TOPICS.length]
		for (const m of [
			{ role: "user", content: userMessage(i, topic) },
			{ role: "assistant", content: assistantMessage(i, topic) },
		]) {
			batch.push(m)
			total += estimateMessageTokens(m)
			count++
		}
		if (batch.length >= BATCH_SIZE) await flush()
	}
	await flush()

	console.log(`Thread ${thread.id}: ${count} pesan, ~${total} token (estimasi context.js)`)
	await pool.end()
}

main().catch(async (err) => {
	console.error(err)
	await pool.end()
	process.exit(1)
})
