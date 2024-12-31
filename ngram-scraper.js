class NgramScraper {
	constructor() {
		this.baseUrl = "https://books.google.com/ngrams/json";
		// More complete browser-like headers
		this.headers = {
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
		};
	}

	createParams(words) {
		return new URLSearchParams({
			content: words.join(","),
			year_start: "2021",
			year_end: "2022",
			corpus: "en",
			smoothing: "3",
			case_insensitive: "true",
		});
	}

	async scrapeNgrams(words) {
		try {
			const params = this.createParams(words);
			const url = `${this.baseUrl}?${params.toString()}`;

			console.log("Fetching data from:", url);

			const response = await fetch(url, {
				headers: this.headers,
				method: "GET",
			});

			if (!response.ok) {
				throw new Error(`HTTP error! status: ${response.status}`);
			}

			const data = await response.json();

			// Create results map
			const resultsMap = new Map();
			data
				.filter((item) => item.type === "CASE_INSENSITIVE")
				.forEach((item) => {
					const word = item.ngram.replace(" (All)", "");
					const freq = item.timeseries[item.timeseries.length - 1] * 100; // Convert to percentage
					resultsMap.set(word, freq.toFixed(10));
				});

			// Format final output
			const word_freq = words.map((word) => ({
				word,
				freq: resultsMap.has(word) ? resultsMap.get(word) : "-1.0",
			}));

			const result = {
				year: "2022",
				word_freq,
			};

			// Pretty print the results
			console.log(JSON.stringify(result, null, 2));
			return result;
		} catch (error) {
			console.error("Error scraping ngram data:", error);
			throw error;
		}
	}
}

// Example usage
async function main() {
	const words =
		process.argv.slice(2).length > 0
			? process.argv.slice(2)
			: [
					"Time",
					"person",
					"year",
					"way",
					"day",
					"thing",
					"man",
					"world",
					"life",
					"hand",
					"part",
					"child",
			  ];

	const scraper = new NgramScraper();

	try {
		console.log("Searching for words:", words);
		await scraper.scrapeNgrams(words);
	} catch (error) {
		console.error("Script failed:", error.message);
		process.exit(1);
	}
}

main();
