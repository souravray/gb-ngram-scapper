import { Actor } from "apify";

// Function to get input from various sources
async function getInputData() {
	// Try to get input from APIFY_INPUT_PATH first
	if (process.env.APIFY_INPUT_PATH) {
		try {
			const fs = await import("fs/promises");
			const data = await fs.readFile(process.env.APIFY_INPUT_PATH, "utf8");
			console.log("Read from input file:", data);
			return JSON.parse(data);
		} catch (e) {
			console.error("Failed to read or parse APIFY_INPUT_PATH:", e);
		}
	}

	// Try to get input from APIFY_INPUT environment variable
	if (process.env.APIFY_INPUT) {
		try {
			return JSON.parse(process.env.APIFY_INPUT);
		} catch (e) {
			console.error("Failed to parse APIFY_INPUT:", e);
		}
	}

	// Fallback to individual environment variables
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
		this.headers = {
			"User-Agent":
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
			Accept: "application/json, text/plain, */*",
			"Accept-Language": "en-US,en;q=0.9",
			"Accept-Encoding": "gzip, deflate, br",
			Referer: "https://books.google.com/ngrams/graph",
			Origin: "https://books.google.com",
			DNT: "1",
			Connection: "keep-alive",
			"Sec-Fetch-Dest": "empty",
			"Sec-Fetch-Mode": "cors",
			"Sec-Fetch-Site": "same-origin",
			"Cache-Control": "no-cache",
			Pragma: "no-cache",
			"sec-ch-ua": `"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"`,
			"sec-ch-ua-mobile": "?0",
			"sec-ch-ua-platform": '"Windows"',
		};
	}

	async createParams(words, yearStart, yearEnd) {
		return new URLSearchParams({
			content: words.join(","),
			year_start: yearStart.toString(),
			year_end: yearEnd.toString(),
			corpus: "en",
			smoothing: "3",
			case_insensitive: "true",
		});
	}

	async scrapeNgrams(words, yearStart, yearEnd) {
		try {
			const params = await this.createParams(words, yearStart, yearEnd);
			const url = `${this.baseUrl}?${params.toString()}`;
			console.log("Fetching data from:", url);

			const response = await fetch(url, {
				headers: this.headers,
				method: "GET",
			});

			if (!response.ok) {
				const errorMsg = `HTTP error! status: ${response.status}`;
				console.error(errorMsg);
				throw new Error(errorMsg);
			}

			const data = await response.json();

			// Create a map to store results
			const resultsMap = new Map();

			// Process the data for found words
			data
				.filter((item) => item.type === "CASE_INSENSITIVE")
				.forEach((item) => {
					const word = item.ngram;
					const freq = item.timeseries[item.timeseries.length - 1] * 100;
					resultsMap.set(word, freq.toFixed(10));
				});

			// Create the final word_freq array including missing words
			const word_freq = words.map((word) => ({
				word,
				freq: resultsMap.has(word) ? resultsMap.get(word) : "-1.0000000000",
			}));

			const result = {
				year: yearEnd.toString() + ".0000000000",
				word_freq,
				timestamp: new Date().toISOString(),
				batch_size: words.length,
			};

			return result;
		} catch (error) {
			console.error("Error scraping ngram data:", error);
			throw error;
		}
	}

	async processBatch(wordBatch, yearStart, yearEnd, batchNumber, totalBatches) {
		try {
			console.log(
				`Processing batch ${batchNumber}/${totalBatches} with ${wordBatch.length} words`
			);
			const results = await this.scrapeNgrams(wordBatch, yearStart, yearEnd);
			await Actor.pushData(results);

			// Write results to a local file
			const fs = await import("fs/promises");
			await fs.writeFile(
				"ngram_results.json",
				JSON.stringify(results, null, 2)
			);

			console.log("\nResults:", JSON.stringify(results, null, 2));
			console.log(`Successfully processed batch ${batchNumber}`);
			console.log("Results have been saved to ngram_results.json");

			// Add delay between batches to avoid rate limiting
			if (batchNumber < totalBatches) {
				const delay = 2000; // 2 seconds
				console.log(`Waiting ${delay}ms before next batch...`);
				await new Promise((resolve) => setTimeout(resolve, delay));
			}
		} catch (error) {
			console.error(`Failed to process batch ${batchNumber}:`, error);
			// Store failed batch information
			await Actor.pushData({
				error: true,
				batch_number: batchNumber,
				failed_words: wordBatch,
				error_message: error.message,
				timestamp: new Date().toISOString(),
			});
			throw error;
		}
	}

	async processAllWords(words, yearStart, yearEnd, batchSize = 12) {
		const totalBatches = Math.ceil(words.length / batchSize);
		console.log(
			`Processing ${words.length} words in ${totalBatches} batches of size ${batchSize}`
		);

		const startTime = new Date();
		let successfulBatches = 0;

		for (let i = 0; i < words.length; i += batchSize) {
			const batch = words.slice(i, i + batchSize);
			const batchNumber = Math.floor(i / batchSize) + 1;

			try {
				await this.processBatch(
					batch,
					yearStart,
					yearEnd,
					batchNumber,
					totalBatches
				);
				successfulBatches++;
			} catch (error) {
				console.error(`Batch ${batchNumber} failed:`, error);
				// Continue with next batch despite error
				continue;
			}
		}

		const endTime = new Date();
		const duration = (endTime - startTime) / 1000; // in seconds

		// Log summary
		console.log(`
Processing completed:
- Total words: ${words.length}
- Total batches: ${totalBatches}
- Successful batches: ${successfulBatches}
- Failed batches: ${totalBatches - successfulBatches}
- Total time: ${duration.toFixed(2)} seconds
- Average time per batch: ${(duration / totalBatches).toFixed(2)} seconds
        `);
	}
}

// Main execution
async function main() {
	try {
		// Get input before Actor initialization
		const input = await getInputData();
		console.log("Input data:", input);

		// Initialize the Actor after getting input
		await Actor.init();

		const {
			words = [],
			yearStart = 2021,
			yearEnd = 2022,
			batchSize = 12,
		} = input;

		// Validate input
		if (!words || !Array.isArray(words) || words.length === 0) {
			throw new Error("Input must contain a non-empty array of words");
		}

		if (batchSize < 1 || batchSize > 20) {
			throw new Error("Batch size must be between 1 and 20");
		}

		// Initialize and run scraper
		const scraper = new NgramScraper();
		await scraper.processAllWords(words, yearStart, yearEnd, batchSize);

		console.log("Actor finished successfully");
	} catch (error) {
		console.error("Actor failed:", error);
		throw error;
	} finally {
		// Cleanup and exit
		await Actor.exit();
	}
}

// Run the main function
main();
