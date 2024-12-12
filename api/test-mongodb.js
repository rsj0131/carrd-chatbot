import { MongoClient } from "mongodb";

async function testMongoDB(req, res) {
    const uri = process.env.MONGODB_URI || "mongodb://localhost:27017"; // Replace with your MongoDB URI
    const dbName = "testDatabase";
    const collectionName = "testCollection";

    const client = new MongoClient(uri);

    try {
        console.log("Connecting to MongoDB...");
        await client.connect();
        console.log("Successfully connected to MongoDB");

        const db = client.db(dbName);
        const collection = db.collection(collectionName);

        // Test write operation
        const testData = { message: "Hello, MongoDB!", timestamp: new Date() };
        const writeResult = await collection.insertOne(testData);

        // Test read operation
        const readResult = await collection.findOne({ _id: writeResult.insertedId });

        console.log("MongoDB Test Successful:", readResult);

        // Send success response
        return res.status(200).json({
            message: `Write and read successful. Message: ${readResult.message}`,
        });
    } catch (error) {
        console.error("MongoDB Test Error:", error.message);

        // Send error response with a valid JSON format
        return res.status(500).json({
            message: `MongoDB test failed. Error: ${error.message}`,
        });
    } finally {
        await client.close();
        console.log("MongoDB connection closed.");
    }
}

export default async function handler(req, res) {
    if (req.method === "GET") {
        return await testMongoDB(req, res);
    } else {
        return res.status(405).json({ message: "Method not allowed" });
    }
}
