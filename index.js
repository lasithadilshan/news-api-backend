require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const NodeCache = require('node-cache');

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

app.listen(PORT, () => {
  console.log(`Custom News Proxy API is running on port ${PORT}`);
});
