import { MongoClient } from "mongodb";

// MongoDB Configuration
const mongoClient = new MongoClient(process.env.MONGODB_URI);

async function connectToDatabase() {
    if (!mongoClient.topology || !mongoClient.topology.isConnected()) {
        await mongoClient.connect();
    }
    return mongoClient.db("caard-bot");
}

export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    const { userID } = req.query;

    if (!userID) {
        return res.status(400).json({ error: "User ID is required" });
    }

    try {
        const db = await connectToDatabase();
        const chatHistoryCollection = db.collection("chatHistory");

        // Fetch chat history for the specific user, sorted by timestamp
        const chatHistory = await chatHistoryCollection
            .find({ userID: String(userID) })
            .sort({ timestamp: 1 })
            .toArray();

        res.status(200).json(chatHistory);
    } catch (error) {
        console.error("Error fetching chat history:", error);
        res.status(500).json({ error: "Failed to fetch chat history" });
    }
}
