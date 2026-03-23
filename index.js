require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const NodeCache = require('node-cache');
const { ChatGoogleGenerativeAI } = require('@langchain/google-genai');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize cache with a standard TTL of 15 minutes (900 seconds)
// This aggressively prevents blowing through the free GNews API 100 requests/day limit.
const cache = new NodeCache({ stdTTL: 900 });

app.use(cors({
  origin: '*', // Allow all origins like GitHub pages
  methods: ['GET', 'OPTIONS']
}));

// Route to fetch Latest Headlines
app.get('/api/headlines', async (req, res) => {
  const { category = 'general', page = 1, max = 10, lang = 'en' } = req.query;
  const cacheKey = `headlines-${category}-${page}-${max}-${lang}`;
  
  if (cache.has(cacheKey)) {
    console.log(`[CACHE HIT] Returning headlines for ${category}`);
    return res.json(cache.get(cacheKey));
  }

  try {
    const response = await axios.get('https://gnews.io/api/v4/top-headlines', {
      params: {
        token: process.env.GNEWS_API_KEY,
        topic: category === 'general' ? undefined : category,
        page,
        max,
        lang
      }
    });

    // Formatting data straight from GNews back to exactly how the React App expects it
    const formattedData = {
      articles: response.data.articles,
      totalArticles: response.data.totalArticles
    };

    cache.set(cacheKey, formattedData);
    console.log(`[API CALL] Fetched headlines for ${category}`);
    return res.json(formattedData);

  } catch (error) {
    if (error.response) {
      return res.status(error.response.status).json({ message: error.response.data.errors || error.message });
    }
    return res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Route to Search News
app.get('/api/search', async (req, res) => {
  const { q, page = 1, max = 10, lang = 'en' } = req.query;
  const cacheKey = `search-${q}-${page}-${max}-${lang}`;
  
  if (cache.has(cacheKey)) {
    console.log(`[CACHE HIT] Returning search results for ${q}`);
    return res.json(cache.get(cacheKey));
  }

  try {
    const response = await axios.get('https://gnews.io/api/v4/search', {
      params: {
        token: process.env.GNEWS_API_KEY,
        q,
        page,
        max,
        lang
      }
    });

    const formattedData = {
      articles: response.data.articles,
      totalArticles: response.data.totalArticles
    };

    cache.set(cacheKey, formattedData);
    console.log(`[API CALL] Fetched search results for ${q}`);
    return res.json(formattedData);

  } catch (error) {
    if (error.response) {
      return res.status(error.response.status).json({ message: error.response.data.errors || error.message });
    }
    return res.status(500).json({ message: 'Internal Server Error' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// AI Summary Route utilizing LangChain + Gemini
app.get('/api/ai-summary', async (req, res) => {
  const { category = 'general', lang = 'en' } = req.query;
  const cacheKey = `ai-summary-${category}-${lang}`;

  if (cache.has(cacheKey)) {
    console.log(`[CACHE HIT] Returning AI summary for ${category}`);
    return res.json({ summary: cache.get(cacheKey) });
  }

  // Ensure Gemini API key is configured safely
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ message: "GEMINI_API_KEY environment variable is missing on the server!" });
  }

  try {
    // 1. Fetch identical headlines we normally serve, pulling explicitly from memory cache if available
    const headlinesCacheKey = `headlines-${category}-1-10-${lang}`;
    let articles = [];

    if (cache.has(headlinesCacheKey)) {
      articles = cache.get(headlinesCacheKey).articles;
    } else {
      const gnewsRes = await axios.get('https://gnews.io/api/v4/top-headlines', {
        params: {
          token: process.env.GNEWS_API_KEY,
          topic: category === 'general' ? undefined : category,
          page: 1, max: 10, lang
        }
      });
      articles = gnewsRes.data.articles;
      cache.set(headlinesCacheKey, { articles, totalArticles: gnewsRes.data.totalArticles }); 
    }

    if (!articles || articles.length === 0) {
      return res.json({ summary: "No news available right now to summarize." });
    }

    // 2. Map contextual articles for LangChain Prompt injection
    const newsContext = articles.slice(0, 5).map(a => `- Headline: ${a.title}\n  Summary: ${a.description}`).join('\n\n');

    // 3. Instanciate LangChain Gemini Model
    const llm = new ChatGoogleGenerativeAI({
      model: "gemini-2.0-flash",
      apiKey: process.env.GEMINI_API_KEY,
      maxOutputTokens: 250,
      temperature: 0.3, // Low temperature forces factual, direct compilation
    });

    const prompt = `You are an expert news aggregator. Read the following top 5 news headlines and their descriptions for the category "${category}". 
Compose a single, highly engaging, and readable 3-sentence summary highlighting the most critical events occurring right now based exclusively on the provided context. Do not use conversational filler (e.g., "Here is a summary"), just return the direct news briefing.

News Context:
${newsContext}

Summary:`;

    // 4. Invoke LLM synchronously
    const response = await llm.invoke(prompt);
    const summaryText = response.content.trim();

    // 5. CACHE IT aggressive for exactly 1 HOUR to maximize API quotas globally and guarantee lightning-fast frontend loading metrics! 
    cache.set(cacheKey, summaryText, 3600);
    console.log(`[AI GENERATED] Generated LangChain summary utilizing Gemini 1.5 Flash for ${category}!`);

    return res.json({ summary: summaryText });
  } catch (error) {
    console.error("AI Summary generation failed:", error);
    return res.status(500).json({ message: 'Failed to securely generate LangChain summary', error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Custom News Proxy API is running on port ${PORT}`);
});
