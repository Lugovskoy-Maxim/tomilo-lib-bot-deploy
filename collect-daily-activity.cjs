const { MongoClient } = require('mongodb');

async function main() {
  const env = process.env;
  const encode = encodeURIComponent;
  const uri = env.MONGO_URI && env.MONGO_URI.includes('@')
    ? env.MONGO_URI
    : `mongodb://${encode(env.MONGO_LOGIN)}:${encode(env.MONGO_PASSWORD)}@${env.MONGO_HOST}:${env.MONGO_PORT}/${encode(env.MONGO_DATABASE)}?authSource=${encode(env.MONGO_AUTHDATABASE)}`;
  const date = process.argv[2];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('Date required');
  const start = new Date(date + 'T00:00:00+03:00');
  const end = new Date(start.getTime() + 86400000);
  const collections = { users: 'users', chapters: 'chapters', titles: 'titles', anime: 'animeTitles', episodes: 'animeEpisodes' };
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const db = client.db();
    const counts = await Promise.all(Object.entries(collections).map(async ([key, collection]) => [
      key, await db.collection(collection).countDocuments({ createdAt: { $gte: start, $lt: end } }, { maxTimeMS: 15000 }),
    ]));
    console.log(JSON.stringify({ date, ...Object.fromEntries(counts) }));
  } finally {
    await client.close();
  }
}

main().catch(() => { console.error('Daily activity query failed'); process.exitCode = 1; });
