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

	async processAllWords(words, yearStart, yearEnd, batchSize) {
		const MAX_RETRIES = 5;
		const BASE_DELAY = 2000;
		const store = await Actor.openKeyValueStore("default");

		let lastProcessedIndex = (await store.getValue("lastProcessedIndex")) || 0;
		console.log(`Starting from index: ${lastProcessedIndex}`);

		for (let i = lastProcessedIndex; i < words.length; i += batchSize) {
			const batch = words.slice(i, i + batchSize);
			let retries = 0;
			let delay = BASE_DELAY;
			const jitter = () => Math.random() * 1000;
			let success = false;

			while (!success && retries < MAX_RETRIES) {
				try {
					const result = await this.processBatch(batch, yearStart, yearEnd);
					await Actor.pushData({
						...result,
						processedIndex: i + batch.length,
						totalWords: words.length,
					});

					await store.setValue("lastProcessedIndex", i + batch.length);
					console.log(`Processed ${i + batch.length}/${words.length} words`);
					success = true;
				} catch (error) {
					retries++;
					console.error(`Retry ${retries}/${MAX_RETRIES}: ${error.message}`);

					if (retries === MAX_RETRIES) {
						throw new Error(`Failed processing words: ${batch.join(", ")}`);
					}

					delay = BASE_DELAY * Math.pow(2, retries) + jitter();
					await new Promise((resolve) => setTimeout(resolve, delay));
				}
			}

			if (i + batchSize < words.length) {
				await new Promise((resolve) =>
					setTimeout(resolve, BASE_DELAY + Math.random() * 3000)
				);
			}
		}
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

		if (batchSize < 1 || batchSize > 12) {
			throw new Error("Batch size must be between 1 and 12");
		}

		const scraper = new NgramScraper();
		await scraper.processAllWords(words, yearStart, yearEnd, batchSize);
	} catch (error) {
		console.error("Actor failed:", error);
		throw error;
	} finally {
		const store = await Actor.openKeyValueStore("default");
		const progress = await store.getValue("lastProcessed");
		const dataset = await Actor.openDataset("default");
		console.log("Progress:", progress);
		const { items } = await dataset.getData();
		console.log("Results:", items);
		await Actor.exit();
	}
}

main();
