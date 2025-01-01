import { Actor } from "apify";
import { CheerioCrawler, RequestList } from "crawlee";
import fetch from "node-fetch";

async function getInputData() {
	if (process.env.APIFY_INPUT_PATH) {
		try {
			const fs = await import("fs/promises");
			const data = await fs.readFile(process.env.APIFY_INPUT_PATH, "utf8");
			return JSON.parse(data);
		} catch (e) {
			console.error("Failed to read or parse APIFY_INPUT_PATH:", e);
		}
	}

	if (process.env.APIFY_INPUT) {
		try {
			return JSON.parse(process.env.APIFY_INPUT);
		} catch (e) {
			console.error("Failed to parse APIFY_INPUT:", e);
		}
	}

	return {
		words: process.env.WORDS ? process.env.WORDS.split(",") : [],
		yearStart: parseInt(process.env.YEAR_START || "2021"),
		yearEnd: parseInt(process.env.YEAR_END || "2022"),
		batchSize: parseInt(process.env.BATCH_SIZE || "12"),
	};
}

class NgramScraper {
	constructor() {
		this.baseUrl = "https://books.google.com/ngrams/json";
	}

	createParams(words, yearStart, yearEnd) {
		return new URLSearchParams({
			content: words.join(","),
			year_start: yearStart.toString(),
			year_end: yearEnd.toString(),
			corpus: "en",
			smoothing: "3",
			case_insensitive: "true",
		});
	}

	createUrl(words, yearStart, yearEnd) {
		const params = this.createParams(words, yearStart, yearEnd);
		return `${this.baseUrl}?${params.toString()}`;
	}

	async processBatch(words, yearStart, yearEnd) {
		const url = this.createUrl(words, yearStart, yearEnd);

		try {
			const response = await fetch(url, {
				headers: {
					"User-Agent":
						"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
					Accept: "application/json, text/plain, */*",
					"Accept-Language": "en-US,en;q=0.9",
					"Accept-Encoding": "gzip, deflate, br",
					Referer: "https://books.google.com/ngrams/",
					Origin: "https://books.google.com",
					DNT: "1",
					Connection: "keep-alive",
					"Sec-Fetch-Dest": "empty",
					"Sec-Fetch-Mode": "cors",
					"Sec-Fetch-Site": "same-origin",
					Pragma: "no-cache",
					"Cache-Control": "no-cache",
				},
			});

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const data = await response.json();
			const resultsMap = new Map();

			data
				.filter((item) => item.type === "CASE_INSENSITIVE")
				.forEach((item) => {
					const word = item.ngram.replace(" (All)", "");
					const freq = item.timeseries[item.timeseries.length - 1] * 100;
					resultsMap.set(word, freq.toFixed(10));
				});

			const word_freq = words.map((word) => ({
				word,
				freq: resultsMap.has(word) ? resultsMap.get(word) : "-1.0000000000",
			}));

			const result = {
				year: yearEnd.toString(),
				word_freq,
				timestamp: new Date().toISOString(),
				batch_size: words.length,
			};

			const fs = await import("fs/promises");
			await fs.writeFile("ngram_results.json", JSON.stringify(result, null, 2));
			await Actor.pushData(result);

			return result;
		} catch (error) {
			console.error("Error processing batch:", error);
			throw error;
		}
	}

	async processAllWords(words, yearStart, yearEnd, batchSize = 12) {
		const batches = [];
		for (let i = 0; i < words.length; i += batchSize) {
			batches.push(words.slice(i, i + batchSize));
		}

		const startTime = new Date();
		let successfulBatches = 0;

		for (let i = 0; i < batches.length; i++) {
			try {
				await this.processBatch(batches[i], yearStart, yearEnd);
				successfulBatches++;

				if (i < batches.length - 1) {
					await new Promise((resolve) => setTimeout(resolve, 2000));
				}
			} catch (error) {
				console.error(`Batch ${i + 1} failed:`, error);
				continue;
			}
		}

		const endTime = new Date();
		const duration = (endTime - startTime) / 1000;

		console.log(
			`Completed: ${successfulBatches}/${
				batches.length
			} batches in ${duration.toFixed(2)}s`
		);
	}
}

async function main() {
	try {
		const input = await getInputData();
		await Actor.init();

		const {
			words = [],
			yearStart = 2021,
			yearEnd = 2022,
			batchSize = 12,
		} = input;

		if (!words || !Array.isArray(words) || words.length === 0) {
			throw new Error("Input must contain a non-empty array of words");
		}

		if (batchSize < 1 || batchSize > 20) {
			throw new Error("Batch size must be between 1 and 20");
		}

		const scraper = new NgramScraper();
		await scraper.processAllWords(words, yearStart, yearEnd, batchSize);
	} catch (error) {
		console.error("Actor failed:", error);
		throw error;
	} finally {
		await Actor.exit();
	}
}

main();
