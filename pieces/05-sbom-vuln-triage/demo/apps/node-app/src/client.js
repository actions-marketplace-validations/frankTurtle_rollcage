const axios = require('axios');

async function fetchPrices(url) {
  const response = await axios.get(url, { timeout: 2000 });
  return response.data;
}

module.exports = { fetchPrices };
