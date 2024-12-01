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

export async function run() {
  try {
    console.log(uri);

    // Connect to the database
    await connectToDatabase();

    // Perform any database operations here

    console.log("Successfully connected to MongoDB with Mongoose!");
  } finally {
    // Ensures that the connection will close when you finish/error
    await mongoose.connection.close();
  }
}

run().catch(console.dir);