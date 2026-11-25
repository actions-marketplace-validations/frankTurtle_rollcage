import axios from 'axios';

export async function fetchPrices(url) {
  const response = await axios.get(url, { timeout: 2000 });
  return response.data;
}
