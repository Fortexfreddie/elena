import 'dotenv/config';
import { Redis } from '@upstash/redis';
import { QdrantClient } from '@qdrant/js-client-rest';

async function resetDatabases() {
  console.log('🚀 Starting Elena Database Reset (Redis + Qdrant)...');

  // 1. Reset Upstash Redis
  const redisUrl = process.env['UPSTASH_REDIS_REST_URL'];
  const redisToken = process.env['UPSTASH_REDIS_TOKEN'];

  if (redisUrl && redisToken) {
    try {
      console.log('🧹 Clearing Upstash Redis...');
      const redis = new Redis({ url: redisUrl, token: redisToken });
      await redis.flushall();
      console.log('✅ Redis cleared successfully.');
    } catch (err) {
      console.error('❌ Failed to clear Redis:', err);
    }
  } else {
    console.warn('⚠️ Redis credentials missing, skipping...');
  }

  // 2. Reset Qdrant
  const qdrantUrl = process.env['QDRANT_URL'];
  const qdrantKey = process.env['QDRANT_API_KEY'];
  const collectionName = process.env['QDRANT_COLLECTION'] ?? 'elena-memory';

  if (qdrantUrl && qdrantKey) {
    try {
      const host = qdrantUrl.replace(/^https?:\/\//, '');
      console.log(`🧹 Deleting Qdrant collection: ${collectionName} at ${host}...`);
      const qdrant = new QdrantClient({ 
        host,
        apiKey: qdrantKey,
        port: 443,
        https: true,
        checkCompatibility: false
      });
      
      console.log(`🧹 Attempting direct deletion of collection '${collectionName}'...`);
      try {
        await qdrant.deleteCollection(collectionName);
        console.log(`✅ Qdrant collection '${collectionName}' deleted.`);
      } catch (err: any) {
        if (err.status === 404 || err.statusText === 'Not Found' || (err.body && err.body.status === 'error')) {
          console.log(`ℹ️ Qdrant collection '${collectionName}' does not exist (404). Clean state confirmed.`);
        } else {
          console.error(`❌ Failed to delete Qdrant collection (Status: ${err.status}):`, err.body || err.message || err);
        }
      }
    } catch (err) {
      console.error('❌ Failed to clear Qdrant:', err);
    }
  } else {
    console.warn('⚠️ Qdrant credentials missing, skipping...');
  }

  console.log('✨ Reset of external databases complete.');
}

resetDatabases().catch(err => {
  console.error('💥 Fatal error during reset:', err);
  process.exit(1);
});
