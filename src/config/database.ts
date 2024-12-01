import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const uri = `mongodb+srv://${encodeURIComponent(process.env.MONGO_USERNAME!)}:${encodeURIComponent(process.env.MONGO_PASSWORD!)}@rpgclub.5quuxcm.mongodb.net/?retryWrites=true&w=majority&appName=rpgclub`;

export async function connectToDatabase() {
  try {
    await mongoose.connect(uri, {
      serverApi: {
        version: '1',
        strict: true,
        deprecationErrors: true,
      }
    });
    console.log("Connected to MongoDB using Mongoose!");
  } catch (error) {
    console.error("Error connecting to MongoDB:", error);
  }
}