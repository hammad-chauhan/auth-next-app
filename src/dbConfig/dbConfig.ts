import mongoose, { type Mongoose } from 'mongoose';

type ConnectionPromise = Promise<Mongoose> | null;

let connectionPromise: ConnectionPromise = null;
let connectedMongoose: Mongoose | null = null;
let activeMongoUri: string | null = null;
let connectionHandlersRegistered = false;

function getMongoUri(): string {
  const mongoUri = process.env.MONGO_URI?.trim();

  if (!mongoUri) {
    throw new Error('MONGO_URI environment variable is not configured');
  }

  return mongoUri;
}

function registerConnectionHandlers() {
  if (connectionHandlersRegistered) {
    return;
  }

  const connection = mongoose.connection;

  connection.on('connected', () => {
    console.log('MongoDB is connected');
  });

  connection.on('error', (err) => {
    console.log('MongoDB connection error. Please make sure MongoDB is running. ' + err);
  });

  connectionHandlersRegistered = true;
}

function resetPendingConnection() {
  connectionPromise = null;
  connectedMongoose = null;
  activeMongoUri = null;
}

export default async function connect(): Promise<Mongoose> {
  const mongoUri = getMongoUri();

  registerConnectionHandlers();

  if (mongoose.connection.readyState === 1) {
    connectedMongoose = connectedMongoose || mongoose;
    activeMongoUri = mongoUri;
    return connectedMongoose;
  }

  if (connectionPromise && activeMongoUri === mongoUri) {
    return connectionPromise;
  }

  activeMongoUri = mongoUri;

  try {
    connectionPromise = Promise.resolve(mongoose.connect(mongoUri))
      .then((mongooseInstance) => {
        connectedMongoose = mongooseInstance;
        return mongooseInstance;
      })
      .catch((error) => {
        resetPendingConnection();
        throw error;
      });
  } catch (error) {
    resetPendingConnection();
    throw error;
  }

  return connectionPromise;
}
